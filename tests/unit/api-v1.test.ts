// LOT C (option B) — API publique v1 : on teste les helpers PURS (auth machine,
// CORS, parsing/scoping des filtres). Les route handlers (qui touchent la DB) sont
// couverts par le build ; ici on verrouille le contrat de sécurité/filtrage.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateApi, type ApiPrincipal } from "../../apps/console/lib/api/auth";
import { corsHeaders } from "../../apps/console/lib/api/cors";
import { parseApiFilters } from "../../apps/console/lib/api/params";
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

describe("parseApiFilters — normalisation + scoping RBAC", () => {
  const sp = (q: string) => new URLSearchParams(q);

  it("défauts : app=null (all), period=24h, device=null", () => {
    const f = parseApiFilters(sp(""), ADMIN);
    expect(f.app).toBeNull();
    expect(f.period).toBe("24h");
    expect(f.legacy).toEqual({ app: null, period: "24h", device: null });
    expect(f.v2).toEqual({ app: "all", period: "24h", device: "all" });
  });

  it("normalise period (7j -> 7d) et valeurs invalides -> 24h", () => {
    expect(parseApiFilters(sp("period=7j"), ADMIN).period).toBe("7d");
    expect(parseApiFilters(sp("period=zzz"), ADMIN).period).toBe("24h");
    expect(parseApiFilters(sp("period=1h"), ADMIN).period).toBe("1h");
  });

  it("device : mobile/desktop -> legacy ; tablet -> legacy null mais v2 tablet", () => {
    const t = parseApiFilters(sp("device=tablet"), ADMIN);
    expect(t.legacy.device).toBeNull();
    expect(t.v2.device).toBe("tablet");
    const m = parseApiFilters(sp("device=mobile"), ADMIN);
    expect(m.legacy.device).toBe("mobile");
    expect(m.v2.device).toBe("mobile");
  });

  it("admin/token : app demandée respectée, 'all' -> null", () => {
    expect(parseApiFilters(sp("app=client-z"), ADMIN).app).toBe("client-z");
    expect(parseApiFilters(sp("app=all"), ADMIN).app).toBeNull();
  });

  it("viewer scopé : app autorisée OK", () => {
    expect(parseApiFilters(sp("app=client-b"), VIEWER_SCOPED).app).toBe("client-b");
  });

  it("viewer scopé : app hors scope ou 'all' -> rabattu sur la 1re app autorisée", () => {
    expect(parseApiFilters(sp("app=client-x"), VIEWER_SCOPED).app).toBe("client-a");
    expect(parseApiFilters(sp("app=all"), VIEWER_SCOPED).app).toBe("client-a");
    expect(parseApiFilters(sp(""), VIEWER_SCOPED).app).toBe("client-a");
    expect(parseApiFilters(sp("app=client-x"), VIEWER_SCOPED).v2.app).toBe("client-a");
  });
});
