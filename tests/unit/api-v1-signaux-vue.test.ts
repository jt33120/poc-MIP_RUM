// Les signaux de vue du SDK web ≥ 0.6, servis par l'API v1 : `GET /api/v1/engagement`,
// `/spa-loads`, `/page-weight` et `/user-timings` (04/10/2026).
//
// Ce que ces cas verrouillent :
//   - UNE SEULE LECTURE : chaque route rend ce que rend la lecture de l'écran /pages
//     (`lib/queries-engagement.ts`), telle quelle, dans l'enveloppe { meta, data } ;
//   - les filtres du contrat (app, période, env, release…) arrivent à la lecture ;
//   - la limite : 50 par défaut, 200 au plus — et la spec dit la même chose ;
//   - la console ne fait que TRANSMETTRE (aucune lecture de base, cliquet C-R), et la
//     spec annonce ces routes au jeton seulement, sans `service` (qu'elles refusent) ;
//   - le serveur MCP les appelle avec les seuls paramètres qu'il déclare.
// Les lectures SQL sont simulées ; elles sont prouvées sur PostgreSQL
// (tests/integration/engagement-sql.test.ts) et par le contrat de parité.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lectures = vi.hoisted(() => ({
  engagementParRoute: vi.fn(),
  chargementsSpaParRoute: vi.fn(),
  poidsDesVuesParRoute: vi.fn(),
  reperesParNom: vi.fn(),
}));
vi.mock("@/lib/queries-engagement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-engagement")>()),
  ...lectures,
}));

import { GET as ENGAGEMENT } from "../../apps/console/lib/api/service/engagement";
import { GET as SPA } from "../../apps/console/lib/api/service/spa-loads";
import { GET as POIDS } from "../../apps/console/lib/api/service/page-weight";
import { GET as REPERES } from "../../apps/console/lib/api/service/user-timings";
import { SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX } from "../../apps/console/lib/api/signaux-vue";
import { buildOpenApi } from "../../apps/console/lib/api/openapi";
import { ROUTES_SERVICE_SEUL } from "../../services/api/routeur.mjs";
import { construireChemin, outilParNom } from "../../packages/mcp-tools/lib/catalogue.mjs";
import type { ParRoute, EngagementRoute, Reperes } from "../../apps/console/lib/queries-engagement";

function requete(chemin: string) {
  const url = `http://console.test/api/v1${chemin}`;
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({ authorization: "Bearer global" }),
    cookies: { get: () => undefined },
  } as never;
}
const contexte = { params: Promise.resolve({}) };

const ligne = (route: string | null, vues: number): EngagementRoute => ({
  route,
  vues,
  temps_p50_ms: vues >= 13 ? 42_300 : null,
  temps_p75_ms: vues >= 13 ? 118_000 : null,
  manque: vues >= 13 ? null : `${vues} vues, 13 requises`,
  defilement_n: vues,
  defilement_p50_pct: vues >= 13 ? 64 : null,
  part_defilement_profond: vues >= 13 ? 0.31 : null,
  manque_defilement: vues >= 13 ? null : `${vues} vues, 13 requises`,
});
const ENGAGEMENT_LU: ParRoute<EngagementRoute> = {
  ensemble: ligne(null, 619),
  routes: [ligne("/dossiers", 612), ligne("/aide", 7)],
  routesTotal: 2,
  tronque: false,
  requis: 13,
};
const REPERES_LUS: Reperes = {
  reperes: [{ nom: "measure:recherche", source: "measure", n: 412, p50_ms: 180, p75_ms: 340, manque: null }],
  total: 1,
  tronque: false,
  requis: 13,
};

beforeEach(() => {
  process.env.CONSOLE_API_TOKENS = "global,tok-a@app-a";
  lectures.engagementParRoute.mockResolvedValue(ENGAGEMENT_LU);
  lectures.chargementsSpaParRoute.mockResolvedValue({ ensemble: { route: null, n: 0, p50_ms: null, p75_ms: null, manque: "0 chargement, 13 requis" }, routes: [], routesTotal: 0, tronque: false, requis: 13 });
  lectures.poidsDesVuesParRoute.mockResolvedValue({ ensemble: { route: null, vues: 0, ressources_p50: null, manque: "0 vue, 13 requises", octets_n: 0, octets_p75: null, manque_octets: "0 vue, 13 requises" }, routes: [], routesTotal: 0, tronque: false, requis: 13 });
  lectures.reperesParNom.mockResolvedValue(REPERES_LUS);
});
afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  vi.clearAllMocks();
});

const ROUTES = [
  ["/engagement", ENGAGEMENT, lectures.engagementParRoute],
  ["/spa-loads", SPA, lectures.chargementsSpaParRoute],
  ["/page-weight", POIDS, lectures.poidsDesVuesParRoute],
  ["/user-timings", REPERES, lectures.reperesParNom],
] as const;

describe("les quatre routes : la lecture de l'écran /pages, telle quelle", () => {
  it("GET /engagement : l'enveloppe { meta, data }, data = ce que rend la lecture, ETag compris", async () => {
    const reponse = await ENGAGEMENT(requete("/engagement?app=app-a&period=7d"), contexte);
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("etag")).toBeTruthy();
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(corps.meta.period).toBe("7d");
    expect(corps.data).toEqual(ENGAGEMENT_LU);
    // Sous l'effectif requis : null et ce qui manque, jamais 0.
    expect(corps.data.routes[1]).toMatchObject({ temps_p50_ms: null, manque: "7 vues, 13 requises" });
  });

  it("GET /user-timings : les repères par nom, avec leur source", async () => {
    const corps = await (await REPERES(requete("/user-timings?app=app-a"), contexte)).json();
    expect(corps.data).toEqual(REPERES_LUS);
  });

  it.each(ROUTES)("GET %s : les filtres du contrat arrivent à la lecture (période, env, release, appareil)", async (chemin, GET, lecture) => {
    const reponse = await GET(requete(`${chemin}?app=app-a&period=24h&env=prod&release=1.2.0&device=mobile`), contexte);
    expect(reponse.status).toBe(200);
    const [filtres, limite] = lecture.mock.calls[0] as [
      { app: string; device: string; query: { range: { preset: string }; filters: Record<string, unknown> } },
      number,
    ];
    expect(filtres.app).toBe("app-a");
    expect(filtres.device).toBe("mobile");
    expect(filtres.query.range.preset).toBe("24h");
    expect(filtres.query.filters).toMatchObject({ env: "prod", release: "1.2.0", device: "mobile" });
    expect(limite).toBe(SIGNAUX_VUE_DEFAUT);
  });

  it.each(ROUTES)("GET %s : `limit` borné à 1..200", async (chemin, GET, lecture) => {
    await GET(requete(`${chemin}?limit=5`), contexte);
    await GET(requete(`${chemin}?limit=5000`), contexte);
    await GET(requete(`${chemin}?limit=0`), contexte);
    expect(lecture.mock.calls.map((c) => c[1])).toEqual([5, SIGNAUX_VUE_MAX, SIGNAUX_VUE_DEFAUT]);
  });

  it.each(ROUTES)("GET %s : app hors périmètre du jeton : 403, avant toute lecture", async (chemin, GET, lecture) => {
    const req = requete(`${chemin}?app=app-b`) as unknown as { headers: Headers };
    req.headers.set("authorization", "Bearer tok-a");
    const reponse = await GET(req as never, contexte);
    expect(reponse.status).toBe(403);
    expect(lecture).not.toHaveBeenCalled();
  });
});

describe("servies par le service seul, et la spec le dit", () => {
  const CHEMINS = ["/engagement", "/spa-loads", "/page-weight", "/user-timings"];

  it("chaque route est dans ROUTES_SERVICE_SEUL ; la console ne fait que transmettre", () => {
    for (const chemin of CHEMINS) {
      const entree = ROUTES_SERVICE_SEUL.find((r: { chemin: string }) => r.chemin === `/api/v1${chemin}`);
      expect(entree, chemin).toBeTruthy();
      const route = readFileSync(join("apps/console/app/api/v1", chemin, "route.ts"), "utf8");
      expect(route, chemin).toContain("export const GET = transmettreAuService;");
      expect(route, chemin).not.toMatch(/queries|lib\/db/);
    }
  });

  it("la spec : au jeton seulement, 503 du service, sans `service`, avec la limite de lib/api/signaux-vue.ts", () => {
    const spec = buildOpenApi() as {
      paths: Record<string, { get: { security: unknown[]; parameters: { $ref: string }[]; responses: Record<string, { content?: { "application/json": { schema: { properties: { data: { $ref: string } } } } } }> } }>;
      components: { parameters: Record<string, { schema: { default: number; maximum: number } }>; schemas: Record<string, unknown> };
    };
    for (const chemin of CHEMINS) {
      const op = spec.paths[chemin].get;
      expect(op.security, chemin).toEqual([{ bearerAuth: [] }]);
      expect(op.responses["503"], chemin).toBeTruthy();
      const params = op.parameters.map((p) => p.$ref);
      expect(params, chemin).not.toContain("#/components/parameters/service");
      expect(params, chemin).toContain("#/components/parameters/release");
      expect(params, chemin).toContain("#/components/parameters/env");
      expect(params, chemin).toContain("#/components/parameters/signalLimit");
      const schema = op.responses["200"].content!["application/json"].schema.properties.data.$ref.split("/").pop()!;
      expect(spec.components.schemas[schema], `${chemin} → ${schema}`).toBeTruthy();
    }
    expect(spec.components.parameters.signalLimit.schema).toMatchObject({ default: SIGNAUX_VUE_DEFAUT, maximum: SIGNAUX_VUE_MAX });
  });

  it("le schéma d'une ligne publie chaque champ de la lecture, et seulement eux", () => {
    const spec = buildOpenApi() as { components: { schemas: Record<string, { properties: Record<string, unknown> }> } };
    expect(Object.keys(spec.components.schemas.EngagementRoute.properties).sort()).toEqual(Object.keys(ENGAGEMENT_LU.ensemble).sort());
    expect(Object.keys(spec.components.schemas.UserTiming.properties).sort()).toEqual(Object.keys(REPERES_LUS.reperes[0]).sort());
    expect(Object.keys(spec.components.schemas.Engagement.properties).sort()).toEqual(Object.keys(ENGAGEMENT_LU).sort());
  });
});

describe("MCP — quatre outils en lecture", () => {
  it.each([
    ["mip_rum_get_engagement", "/engagement"],
    ["mip_rum_get_spa_loads", "/spa-loads"],
    ["mip_rum_get_page_weight", "/page-weight"],
    ["mip_rum_list_user_timings", "/user-timings"],
  ])("%s → %s, avec app, période, appareil, env, release, route et limite — rien d'autre", (nom, chemin) => {
    const outil = outilParNom(nom);
    expect(outil?.chemin).toBe(chemin);
    expect("corps" in outil!).toBe(false);
    expect(
      construireChemin(outil!, { app: "uti", period: "7d", device: "desktop", env: "prod", release: "1.2.0", route: "/dossiers", limit: 10, browser: "Firefox" }),
    ).toBe(`${chemin}?app=uti&period=7d&device=desktop&env=prod&release=1.2.0&route=%2Fdossiers&limit=10`);
  });
});
