// Cœur d'ingestion Postgres nu (apps/ingest/lib/pg-ingest.mjs) — partagé par le
// dev-server Node et les routes Next.js de prod (/api/ingest/v1/*), depuis que
// l'ingestion a quitté les edge functions Supabase.
//
// Ce qui est testé ici est la PARITÉ avec _shared/auth.mjs (le modèle de
// décision qui tournait en prod) : keyless REJETÉ sous REQUIRE_API_KEY
// (durcissement E1-S1), app inconnue rejetée, fail-open si le registre n'a
// jamais pu être chargé, rate limit mémoire + durable avec repli. Une
// divergence ici rouvrirait silencieusement l'ingestion — c'est exactement ce
// que le module partagé existe pour empêcher.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPgAuth } from "../../apps/ingest/lib/pg-ingest.mjs";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Faux pool `pg` : `rows` = contenu d'app_registry ; le verdict de rate_check
 * et les pannes sont pilotables. Compte les chargements pour prouver le cache.
 */
function fakePool(
  rows: unknown[],
  opts: { registryError?: boolean; rate?: boolean | Error } = {},
) {
  let registryLoads = 0;
  return {
    registryLoads: () => registryLoads,
    async query(sql: string) {
      if (sql.includes("app_registry")) {
        registryLoads++;
        if (opts.registryError) throw new Error("boom");
        return { rows };
      }
      if (sql.includes("rate_check")) {
        if (opts.rate instanceof Error) throw opts.rate;
        // rate_check() : true = sous la limite (accepté), false = dépassé.
        return { rows: [{ ok: opts.rate === false ? false : true }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

describe("createPgAuth.checkApiKey", () => {
  it("requireApiKey=false : jamais de rejet (défaut CI/local)", async () => {
    const auth = createPgAuth(fakePool([]) as never, { requireApiKey: false });
    expect(await auth.checkApiKey("whatever", null)).toBeNull();
  });

  it("clé valide acceptée", async () => {
    const pool = fakePool([
      { app_id: "app1", api_key_hash: sha256("secret"), active: true, allowed_origins: [] },
    ]);
    const auth = createPgAuth(pool as never, { requireApiKey: true });
    expect(await auth.checkApiKey("app1", "secret")).toBeNull();
  });

  it("clé invalide rejetée", async () => {
    const pool = fakePool([
      { app_id: "app1", api_key_hash: sha256("secret"), active: true, allowed_origins: [] },
    ]);
    const auth = createPgAuth(pool as never, { requireApiKey: true });
    expect(await auth.checkApiKey("app1", "wrong")).toMatch(/invalid api key/);
  });

  it("app inconnue ou inactive rejetée", async () => {
    const pool = fakePool([
      { app_id: "off", api_key_hash: null, active: false, allowed_origins: [] },
    ]);
    const auth = createPgAuth(pool as never, { requireApiKey: true });
    expect(await auth.checkApiKey("ghost", "k")).toMatch(/unknown or inactive/);
    expect(await auth.checkApiKey("off", "k")).toMatch(/unknown or inactive/);
  });

  it("E1-S1 : sous REQUIRE_API_KEY, une app SANS clé est REJETÉE (plus de keyless)", async () => {
    const pool = fakePool([
      { app_id: "keyless", api_key_hash: null, active: true, allowed_origins: [] },
    ]);
    const auth = createPgAuth(pool as never, { requireApiKey: true });
    expect(await auth.checkApiKey("keyless", null)).toMatch(/requires an API key/);
  });

  it("registre JAMAIS chargé (panne DB) : fail-open, pas 403 sur tout le trafic", async () => {
    const pool = fakePool([], { registryError: true });
    const auth = createPgAuth(pool as never, { requireApiKey: true });
    expect(await auth.checkApiKey("app1", null)).toBeNull();
  });

  it("registre mis en cache 60 s (une seule lecture pour deux vérifs)", async () => {
    const pool = fakePool([
      { app_id: "app1", api_key_hash: sha256("s"), active: true, allowed_origins: [] },
    ]);
    const auth = createPgAuth(pool as never, { requireApiKey: true });
    await auth.checkApiKey("app1", "s");
    await auth.checkApiKey("app1", "s");
    expect(pool.registryLoads()).toBe(1);
  });
});

describe("createPgAuth.rateLimitedDurable", () => {
  it("sous la limite : accepté", async () => {
    const auth = createPgAuth(fakePool([], { rate: true }) as never, { rateLimitPerMin: 10 });
    expect(await auth.rateLimitedDurable("app1")).toBe(false);
  });

  it("verdict durable négatif : limité", async () => {
    const auth = createPgAuth(fakePool([], { rate: false }) as never, { rateLimitPerMin: 10 });
    expect(await auth.rateLimitedDurable("app1")).toBe(true);
  });

  it("compteur mémoire : au-delà de N appels dans la fenêtre, limité sans SQL", async () => {
    const auth = createPgAuth(fakePool([], { rate: true }) as never, { rateLimitPerMin: 2 });
    expect(await auth.rateLimitedDurable("app1")).toBe(false);
    expect(await auth.rateLimitedDurable("app1")).toBe(false);
    expect(await auth.rateLimitedDurable("app1")).toBe(true);
  });

  it("SQL en panne : repli sur le verdict mémoire (accepté), pas de rejet", async () => {
    const auth = createPgAuth(fakePool([], { rate: new Error("down") }) as never, {
      rateLimitPerMin: 10,
    });
    expect(await auth.rateLimitedDurable("app1")).toBe(false);
  });

  it("fenêtre glissante : le quota se libère quand le temps avance", async () => {
    let t = 1_000_000;
    const auth = createPgAuth(fakePool([], { rate: true }) as never, {
      rateLimitPerMin: 1,
      now: () => t,
    });
    expect(await auth.rateLimitedDurable("app1")).toBe(false);
    expect(await auth.rateLimitedDurable("app1")).toBe(true);
    t += 61_000; // au-delà de la fenêtre de 60 s
    expect(await auth.rateLimitedDurable("app1")).toBe(false);
  });

  it("les compteurs sont par app (un client bruyant n'affame pas les autres)", async () => {
    const auth = createPgAuth(fakePool([], { rate: true }) as never, { rateLimitPerMin: 1 });
    expect(await auth.rateLimitedDurable("noisy")).toBe(false);
    expect(await auth.rateLimitedDurable("noisy")).toBe(true);
    expect(await auth.rateLimitedDurable("quiet")).toBe(false);
  });
});
