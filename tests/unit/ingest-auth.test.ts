// Auth d'ingestion partagée (_shared/auth.mjs) — utilisée par v1-traces ET
// v1-replay. On teste le modèle de vérif de clé (keyless toléré, app inconnue
// rejetée, fail-open si registre jamais chargé) et le rate limit (fenêtre + RPC
// durable + fallback), avec un faux client supabase piloté par les tests.
import { describe, expect, it } from "vitest";
import { createAuth } from "../../apps/ingest/supabase/functions/_shared/auth.mjs";

// SHA-256 hex (parité avec l'implémentation) pour fabriquer des hash de clés.
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Faux client supabase : `rows` = contenu d'app_registry ; rpc rate_check pilotable. */
function fakeSupabase(rows: unknown[], opts: { registryError?: boolean; rate?: boolean | Error } = {}) {
  let registryLoads = 0;
  return {
    registryLoads: () => registryLoads,
    from() {
      return {
        select: async () => {
          registryLoads++;
          if (opts.registryError) return { data: null, error: { message: "boom" } };
          return { data: rows, error: null };
        },
      };
    },
    async rpc(_name: string, _args: unknown) {
      if (opts.rate instanceof Error) return { data: null, error: opts.rate };
      // rate_check() renvoie true = "sous la limite" (accepté), false = dépassé.
      // `opts.rate` EST ce verdict brut (défaut : true = accepté).
      return { data: opts.rate === false ? false : true, error: null };
    },
  };
}

describe("createAuth.checkApiKey", () => {
  it("requireApiKey=false : jamais de rejet (CI/local)", async () => {
    const auth = createAuth(fakeSupabase([]) as never, { requireApiKey: false });
    expect(await auth.checkApiKey("whatever", null)).toBeNull();
  });

  it("app inconnue -> rejet", async () => {
    const auth = createAuth(fakeSupabase([{ app_id: "a", api_key_hash: null, active: true }]) as never, {
      requireApiKey: true,
    });
    expect(await auth.checkApiKey("inconnue", null)).toMatch(/unknown or inactive/);
  });

  it("app inactive -> rejet", async () => {
    const auth = createAuth(fakeSupabase([{ app_id: "a", api_key_hash: null, active: false }]) as never, {
      requireApiKey: true,
    });
    expect(await auth.checkApiKey("a", null)).toMatch(/unknown or inactive/);
  });

  it("app keyless (api_key_hash null) -> acceptée sans clé (continuité)", async () => {
    const auth = createAuth(fakeSupabase([{ app_id: "a", api_key_hash: null, active: true }]) as never, {
      requireApiKey: true,
    });
    expect(await auth.checkApiKey("a", null)).toBeNull();
    expect(await auth.checkApiKey("a", "clé-quelconque")).toBeNull();
  });

  it("app à clé : clé correcte acceptée, absente ou fausse rejetée", async () => {
    const hash = await sha256("bonne-clé");
    const auth = createAuth(fakeSupabase([{ app_id: "a", api_key_hash: hash, active: true }]) as never, {
      requireApiKey: true,
    });
    expect(await auth.checkApiKey("a", "bonne-clé")).toBeNull();
    expect(await auth.checkApiKey("a", "mauvaise")).toMatch(/invalid api key/);
    expect(await auth.checkApiKey("a", null)).toMatch(/invalid api key/);
  });

  it("registre jamais chargé (panne DB) -> fail-open", async () => {
    const auth = createAuth(fakeSupabase([], { registryError: true }) as never, { requireApiKey: true });
    expect(await auth.checkApiKey("a", null)).toBeNull();
  });

  it("cache 60 s : un seul chargement du registre pour des appels rapprochés", async () => {
    let t = 1_000_000;
    const sb = fakeSupabase([{ app_id: "a", api_key_hash: null, active: true }]);
    const auth = createAuth(sb as never, { requireApiKey: true, now: () => t });
    await auth.checkApiKey("a", null);
    await auth.checkApiKey("a", null);
    t += 30_000; // < 60 s
    await auth.checkApiKey("a", null);
    expect(sb.registryLoads()).toBe(1);
    t += 40_000; // > 60 s cumulé -> rechargement
    await auth.checkApiKey("a", null);
    expect(sb.registryLoads()).toBe(2);
  });
});

describe("createAuth.rateLimitedDurable", () => {
  it("sous la limite mémoire ET rpc OK -> non limité", async () => {
    const auth = createAuth(fakeSupabase([], { rate: true }) as never, { rateLimitPerMin: 5 });
    expect(await auth.rateLimitedDurable("a")).toBe(false);
  });

  it("dépassement de la fenêtre mémoire -> limité (sans toucher la RPC)", async () => {
    let t = 0;
    const auth = createAuth(fakeSupabase([], { rate: true }) as never, { rateLimitPerMin: 2, now: () => t });
    expect(await auth.rateLimitedDurable("a")).toBe(false); // 1
    expect(await auth.rateLimitedDurable("a")).toBe(false); // 2
    expect(await auth.rateLimitedDurable("a")).toBe(true); // 3 -> dépasse
  });

  it("RPC en échec -> fallback mémoire (non limité)", async () => {
    const auth = createAuth(fakeSupabase([], { rate: new Error("rpc down") }) as never, { rateLimitPerMin: 5 });
    expect(await auth.rateLimitedDurable("a")).toBe(false);
  });
});
