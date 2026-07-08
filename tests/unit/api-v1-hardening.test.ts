// LOT C — durcissement API v1 : helpers PURS (pagination, rate-limit, ETag) + intégrité
// de la spec OpenAPI. Les route handlers (DB/next) restent couverts par le build.
import { describe, expect, it } from "vitest";
import { parsePagination } from "../../apps/console/lib/api/pagination";
import { rateLimit } from "../../apps/console/lib/api/ratelimit";
import { weakEtag } from "../../apps/console/lib/api/etag";
import { buildOpenApi } from "../../apps/console/lib/api/openapi";

const sp = (q: string) => new URLSearchParams(q);

describe("parsePagination — bornes & défauts", () => {
  it("vide -> défaut fourni, offset 0", () => {
    expect(parsePagination(sp(""), 50)).toEqual({ limit: 50, offset: 0 });
  });
  it("limit respectée mais plafonnée au max", () => {
    expect(parsePagination(sp("limit=10"), 50).limit).toBe(10);
    expect(parsePagination(sp("limit=9999"), 50, 200).limit).toBe(200);
  });
  it("valeurs invalides/négatives -> défaut / 0", () => {
    expect(parsePagination(sp("limit=abc&offset=-5"), 50)).toEqual({ limit: 50, offset: 0 });
    expect(parsePagination(sp("limit=0"), 50).limit).toBe(50);
  });
  it("offset pris en compte (entier)", () => {
    expect(parsePagination(sp("offset=40"), 50).offset).toBe(40);
    expect(parsePagination(sp("offset=12.9"), 50).offset).toBe(12);
  });
});

describe("rateLimit — fenêtre glissante en mémoire", () => {
  it("laisse passer sous la limite puis bloque", () => {
    const store = new Map<string, number[]>();
    const a = rateLimit("k", 2, 1000, 1000, store);
    const b = rateLimit("k", 2, 1000, 1000, store);
    const c = rateLimit("k", 2, 1000, 1000, store);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    expect(a.remaining).toBe(1);
    expect(c.remaining).toBe(0);
    expect(c.resetMs).toBeGreaterThan(0);
  });
  it("la fenêtre se libère avec le temps", () => {
    const store = new Map<string, number[]>();
    rateLimit("k", 1, 1000, 1000, store);
    expect(rateLimit("k", 1, 1000, 1500, store).ok).toBe(false); // encore dans la fenêtre
    expect(rateLimit("k", 1, 1000, 2500, store).ok).toBe(true); // hit initial expiré
  });
  it("cloisonné par clé", () => {
    const store = new Map<string, number[]>();
    rateLimit("a", 1, 1000, 1000, store);
    expect(rateLimit("b", 1, 1000, 1000, store).ok).toBe(true);
  });
});

describe("weakEtag", () => {
  it("déterministe et sensible au contenu", () => {
    expect(weakEtag("abc")).toBe(weakEtag("abc"));
    expect(weakEtag("abc")).not.toBe(weakEtag("abd"));
    expect(weakEtag("")).toMatch(/^W\/"[0-9a-f]+"$/);
  });
});

describe("buildOpenApi — spec valide et complète", () => {
  const spec = buildOpenApi() as any;

  it("en-tête OpenAPI 3.0 + info + serveur", () => {
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toContain("MIP RUM");
    expect(spec.servers[0].url).toBe("/api/v1");
  });

  it("couvre tous les endpoints publics et RUM", () => {
    const paths = Object.keys(spec.paths);
    for (const p of [
      "/health", "/openapi", "/", "/apps", "/overview", "/vitals", "/pages",
      "/errors", "/errors/{fingerprint}", "/sessions", "/sessions/{id}",
      "/tracing", "/correlation", "/health-grid", "/ai",
    ])
      expect(paths, `manque ${p}`).toContain(p);
  });

  it("schémas de sécurité Bearer + cookie déclarés", () => {
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(spec.components.securitySchemes.sessionCookie.in).toBe("cookie");
  });

  it("aucun $ref pendouillant (tout référencé existe)", () => {
    const refs: string[] = [];
    const walk = (o: unknown) => {
      if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (k === "$ref" && typeof v === "string") refs.push(v);
          else walk(v);
        }
      }
    };
    walk(spec);
    expect(refs.length).toBeGreaterThan(20);
    for (const r of refs) {
      const parts = r.replace("#/", "").split("/");
      let cur: any = spec;
      for (const p of parts) cur = cur?.[p];
      expect(cur, `ref pendouillante ${r}`).toBeDefined();
    }
  });
});
