// LOT C (option B) — API publique v1 : on teste les helpers PURS (auth machine,
// CORS, parsing/scoping des filtres). Les route handlers (qui touchent la DB) sont
// couverts par le build ; ici on verrouille le contrat de sécurité/filtrage.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateApi, type ApiPrincipal } from "../../apps/console/lib/api/auth";
import { corsHeaders } from "../../apps/console/lib/api/cors";
import { parseApiFilters } from "../../apps/console/lib/api/params";
import { contractErrorStatus } from "../../apps/console/lib/query-contract";
import { signJwt } from "../../apps/console/lib/auth";

const ADMIN: ApiPrincipal = { kind: "token", role: "admin", apps: null, subject: "t" };
const VIEWER_SCOPED: ApiPrincipal = {
  kind: "session",
  role: "viewer",
  apps: ["client-a", "client-b"],
  subject: "v@mip",
};

describe("authenticateApi — jeton machine + cookie de session", () => {
  beforeEach(() => {
    process.env.CONSOLE_API_TOKENS = "secret-a, secret-b";
  });
  afterEach(() => {
    delete process.env.CONSOLE_API_TOKENS;
  });

  it("Bearer valide -> principal token (viewer, toutes apps)", async () => {
    const p = await authenticateApi("Bearer secret-a", null);
    expect(p).toEqual({ kind: "token", role: "viewer", apps: null, subject: "api-token" });
  });

  it("Bearer invalide -> null (ne retombe pas sur le cookie)", async () => {
    const cookie = await signJwt({ email: "a@mip", role: "admin", apps: null });
    expect(await authenticateApi("Bearer mauvais", cookie)).toBeNull();
  });

  it("Bearer insensible à la casse, token tronqué -> pas de match partiel", async () => {
    expect(await authenticateApi("bearer secret-b", null)).not.toBeNull();
    expect(await authenticateApi("Bearer secret", null)).toBeNull();
  });

  it("sans Authorization : cookie JWT valide -> principal session (rôle/scope préservés)", async () => {
    const cookie = await signJwt({ email: "v@mip", role: "viewer", apps: ["x"] });
    const p = await authenticateApi(null, cookie);
    expect(p).toMatchObject({ kind: "session", role: "viewer", apps: ["x"], subject: "v@mip" });
  });

  it("ni Bearer ni cookie -> null", async () => {
    expect(await authenticateApi(null, null)).toBeNull();
    expect(await authenticateApi(null, "cookie-bidon")).toBeNull();
  });

  it("aucun token configuré -> tout Bearer est rejeté", async () => {
    delete process.env.CONSOLE_API_TOKENS;
    expect(await authenticateApi("Bearer secret-a", null)).toBeNull();
  });
});

describe("corsHeaders — liste blanche d'origines", () => {
  afterEach(() => {
    delete process.env.CONSOLE_API_ALLOWED_ORIGINS;
  });

  it("origine listée -> ACAO + credentials + Vary", () => {
    process.env.CONSOLE_API_ALLOWED_ORIGINS = "https://mip.example, https://autre.example";
    const h = corsHeaders("https://mip.example");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://mip.example");
    expect(h["Access-Control-Allow-Credentials"]).toBe("true");
    expect(h["Vary"]).toBe("Origin");
  });

  it("origine non listée -> aucun en-tête CORS", () => {
    process.env.CONSOLE_API_ALLOWED_ORIGINS = "https://mip.example";
    expect(corsHeaders("https://evil.example")).toEqual({});
  });

  it("'*' -> ACAO=* sans credentials", () => {
    process.env.CONSOLE_API_ALLOWED_ORIGINS = "*";
    const h = corsHeaders("https://n-importe.example");
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
    expect(h["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("sans Origin (appel serveur-à-serveur) -> aucun en-tête", () => {
    process.env.CONSOLE_API_ALLOWED_ORIGINS = "https://mip.example";
    expect(corsHeaders(null)).toEqual({});
  });
});

describe("parseApiFilters — contrat commun : normalisation + périmètre signé (P6.2)", () => {
  const sp = (q: string) => new URLSearchParams(q);
  const NOW = Date.parse("2026-09-17T12:00:00.000Z");
  const lire = (q: string, principal: Pick<ApiPrincipal, "role" | "apps"> = ADMIN) => {
    const parsed = parseApiFilters(sp(q), principal, NOW);
    if (!parsed.ok) throw new Error(`refus inattendu : ${parsed.error.code}`);
    return parsed.value;
  };
  const refus = (q: string, principal: Pick<ApiPrincipal, "role" | "apps"> = ADMIN) => {
    const parsed = parseApiFilters(sp(q), principal, NOW);
    if (parsed.ok) throw new Error("acceptation inattendue");
    return parsed.error;
  };

  it("défauts : app=null (all), period=24h, device=null, plage [to-24 h, to) figée", () => {
    const f = lire("");
    expect(f.app).toBeNull();
    expect(f.period).toBe("24h");
    expect(f.device).toBeNull();
    expect(f.legacy).toMatchObject({ app: null, period: "24h", device: null, segment: [] });
    expect(f.v2).toEqual({ app: "all", period: "24h", device: "all" });
    expect(f.query.range).toEqual({
      from: "2026-09-16T12:00:00.000Z",
      to: "2026-09-17T12:00:00.000Z",
      preset: "24h",
      bucketSeconds: 3600,
    });
  });

  it("anciennes URL : period normalisé (7j -> 7d) et valeur inconnue -> 24h, comme documenté", () => {
    expect(lire("period=7j").period).toBe("7d");
    expect(lire("period=zzz").period).toBe("24h");
    expect(lire("period=1h").period).toBe("1h");
    expect(lire("device=zzz").device).toBeNull();
  });

  it("device : mobile/desktop -> legacy ; tablet -> legacy null mais contrat et v2 tablet", () => {
    const t = lire("device=tablet");
    expect(t.legacy.device).toBeNull();
    expect(t.v2.device).toBe("tablet");
    expect(t.query.filters.device).toBe("tablet");
    const m = lire("device=mobile");
    expect(m.legacy.device).toBe("mobile");
    expect(m.v2.device).toBe("mobile");
  });

  it("admin/token : app demandée respectée, 'all' -> null", () => {
    expect(lire("app=client-z").app).toBe("client-z");
    expect(lire("app=all").app).toBeNull();
    expect(lire("app=all").query.scope.effectiveApps).toBeNull();
  });

  it("viewer scopé : app autorisée OK, périmètre effectif réduit à elle", () => {
    const f = lire("app=client-b", VIEWER_SCOPED);
    expect(f.app).toBe("client-b");
    expect(f.query.scope).toEqual({
      requestedApp: "client-b",
      authorizedApps: ["client-a", "client-b"],
      effectiveApps: ["client-b"],
    });
  });

  it("viewer scopé : app hors périmètre REFUSÉE (403), jamais rabattue sur la 1re app", () => {
    const e = refus("app=client-x", VIEWER_SCOPED);
    expect(e).toMatchObject({ code: "forbidden_app", parameter: "app" });
    expect(contractErrorStatus(e)).toBe(403);
  });

  it("viewer scopé : 'all' ou absent = toutes ses apps autorisées, pas la première", () => {
    for (const q of ["app=all", ""]) {
      const f = lire(q, VIEWER_SCOPED);
      expect(f.app).toBeNull();
      expect(f.v2.app).toBe("all");
      expect(f.query.scope.effectiveApps).toEqual(["client-a", "client-b"]);
    }
  });

  it("liste d'apps vide = aucun accès (403), quelle que soit l'app demandée", () => {
    for (const q of ["", "app=all", "app=client-a"]) {
      const e = refus(q, { role: "viewer", apps: [] });
      expect(e.code).toBe("no_app_access");
      expect(contractErrorStatus(e)).toBe(403);
    }
  });

  it("plage personnalisée : [from,to) UTC acceptée, preset custom et seaux dérivés de la durée", () => {
    const f = lire("from=2026-09-10T00:00:00Z&to=2026-09-17T00:00:00Z");
    expect(f.period).toBe("custom");
    expect(f.query.range).toMatchObject({ preset: null, bucketSeconds: 21_600 });
    // Les lectures à presets reçoivent le preset de même largeur de seau.
    expect(f.legacy.period).toBe("7d");
  });

  it.each([
    ["period=7d&from=2026-09-10T00:00:00Z&to=2026-09-11T00:00:00Z", "range_conflict"],
    ["from=2026-09-10T00:00:00Z", "invalid_range"],
    ["from=2026-09-10T00:00:00&to=2026-09-11T00:00:00Z", "invalid_range"],
    ["from=2026-09-11T00:00:00Z&to=2026-09-10T00:00:00Z", "invalid_range"],
    ["from=2026-09-17T11:00:00Z&to=2026-09-17T13:00:00Z", "range_in_future"],
    ["from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:01Z", "range_too_long"],
    ["seg=v2:inconnue:eq:x", "unsupported_dimension"],
    ["seg=geo~~FR", "invalid_filter"],
    ["browser=a%00b", "invalid_filter"],
    ["app=a&app=b", "ambiguous_parameter"],
  ])("refuse %s en 400 typé (%s)", (q, code) => {
    const e = refus(q);
    expect(e.code).toBe(code);
    expect(contractErrorStatus(e)).toBe(400);
  });

  it("dimensions et segments v1/v2 entrent dans la requête résolue", () => {
    const f = lire("browser=Firefox&seg=geo==FR");
    expect(f.query.filters.browser).toBe("Firefox");
    expect(f.query.filters.segments).toEqual([{ dimension: "country", operator: "eq", value: "FR" }]);
    // La façade historique garde le segment v1 qu'elle sait appliquer.
    expect(f.legacy.segment).toEqual([{ dim: "geo", op: "==", value: "FR" }]);
  });
});
