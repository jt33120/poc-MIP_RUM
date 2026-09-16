// LOT C — durcissement API v1 : helpers PURS (pagination, rate-limit, ETag) + intégrité
// de la spec OpenAPI. Les route handlers (DB/next) restent couverts par le build.
import { describe, expect, it } from "vitest";
import { parsePagination } from "../../apps/console/lib/api/pagination";
import { rateLimit } from "../../apps/console/lib/api/ratelimit";
import { weakEtag } from "../../apps/console/lib/api/etag";
import { buildOpenApi, endpointsDeclares } from "../../apps/console/lib/api/openapi";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sp = (q: string) => new URLSearchParams(q);

/** Les routes GET réellement présentes sous app/api/v1, lues sur le disque. */
function routesSurDisque(racine = "apps/console/app/api/v1"): string[] {
  const trouvees: string[] = [];
  const parcourir = (dir: string, prefixe: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) parcourir(join(dir, e.name), `${prefixe}/${e.name}`);
      else if (e.name === "route.ts") {
        const src = readFileSync(join(dir, e.name), "utf8");
        if (/export\s+(const|async\s+function|function)\s+GET/.test(src)) trouvees.push(prefixe || "/");
      }
    }
  };
  parcourir(racine, "");
  return trouvees.map((p) => (p === "/" ? "/" : p)).sort();
}

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
      "/events", "/actions", "/tracing", "/correlation", "/health-grid",
    ])
      expect(paths, `manque ${p}`).toContain(p);
    // La supervision IA (/ai*) a quitté mip-rum pour xSOM AI Guard.
    for (const p of ["/ai", "/ai/costs", "/ai/credits"])
      expect(paths, `${p} ne doit plus être exposé`).not.toContain(p);
  });

  it("schémas de sécurité Bearer + cookie déclarés", () => {
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(spec.components.securitySchemes.sessionCookie.in).toBe("cookie");
  });

  it("documente le 400 et la borne offset propres à /events", () => {
    const events = spec.paths["/events"].get;
    expect(events.responses["400"].$ref).toBe("#/components/responses/BadRequest");
    const params = events.parameters.map((p: { $ref: string }) => p.$ref);
    expect(params).toContain("#/components/parameters/eventOffset");
    expect(spec.components.parameters.eventOffset.schema.maximum).toBe(10_000);
    expect(spec.components.parameters.offset.schema.maximum).toBeUndefined();
    expect(spec.components.schemas.EventIndexRow.properties.id.type).toBe("string");
  });

  it("borne indépendamment la pagination du classement /actions", () => {
    const actions = spec.paths["/actions"].get;
    const params = actions.parameters.map((p: { $ref?: string }) => p.$ref).filter(Boolean);
    expect(params).toContain("#/components/parameters/actionOffset");
    expect(spec.components.parameters.actionOffset.schema.maximum).toBe(10_000);
    expect(spec.components.schemas.TopActionRow.properties.name.type).toBe("string");
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

// La découverte `GET /api/v1` énumérait sa propre liste, écrite à la main. Elle a
// fini par annoncer /api/v1/ai, /ai/costs et /ai/credits — supprimés de la spec
// (le test ci-dessus le vérifiait déjà) mais oubliés là — et par omettre /docs et
// /deploys, qui existent. Sans conséquence tant qu'un humain lisait la réponse ;
// avec le serveur MCP, c'est un modèle qui la lit, et un modèle croit ce qu'on
// lui dit. La liste est maintenant dérivée de la spec ; ce test ferme la boucle
// en la confrontant aux FICHIERS.
describe("endpointsDeclares — la découverte ne peut plus mentir", () => {
  const declares = endpointsDeclares();
  const cheminsDeclares = declares.map((e) => e.path).sort();
  // Correspondance spec → disque : `/` est la découverte elle-même, `{fingerprint}`
  // et `{id}` sont les segments dynamiques, écrits `[x]` sur le disque.
  const versDisque = (p: string) =>
    p.replace(/^\/api\/v1/, "").replace(/\{(\w+)\}/g, "[$1]") || "/";

  it("n'annonce que des routes qui existent sur le disque", () => {
    const disque = new Set(routesSurDisque());
    for (const p of cheminsDeclares)
      expect(disque, `annoncée mais absente du disque : ${p}`).toContain(versDisque(p));
  });

  it("n'oublie aucune route GET existante", () => {
    // /docs sert du HTML (Swagger UI) : ce n'est pas un endpoint de données, il est
    // signalé à part dans le descripteur. Toutes les autres doivent être listées.
    const attendues = routesSurDisque().filter((p) => p !== "/docs");
    const annoncees = new Set(cheminsDeclares.map(versDisque));
    for (const p of attendues) expect(annoncees, `route GET non annoncée : ${p}`).toContain(p);
  });

  it("donne des chemins absolus, prêts à être appelés", () => {
    expect(cheminsDeclares.every((p) => p.startsWith("/api/v1"))).toBe(true);
    expect(cheminsDeclares).toContain("/api/v1");
    expect(cheminsDeclares).toContain("/api/v1/overview");
  });

  it("décrit chaque endpoint", () => {
    for (const e of declares) expect(e.desc.length, e.path).toBeGreaterThan(5);
  });

  it("n'annonce plus aucune route /ai", () => {
    expect(cheminsDeclares.some((p) => p.includes("/ai"))).toBe(false);
  });
});
