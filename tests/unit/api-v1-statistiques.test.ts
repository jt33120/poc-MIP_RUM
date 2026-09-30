// Les statistiques servies par l'API v1 : `GET /api/v1/trends` et `GET /api/v1/detections`.
//
// Ce que ces cas verrouillent :
//   - UN SEUL CALCUL : chaque vital de /trends est exactement ce que rend
//     `analyserSerieQuotidienne` (`@mip/stats`) sur sa série — la fonction de l'écran ;
//   - les refus sont chiffrés, jamais une valeur par défaut (série courte, vital muet) ;
//   - la fenêtre fixe de /trends refuse `period`, `from`, `to` (400), au lieu de les
//     ignorer ; /detections refuse appareil et dimensions (400 typé) ;
//   - la forme d'un constat : la plage habituelle et l'heure qui fait preuve, lues
//     dans ce que le scheduler a écrit, sans rien recalculer.
// Les lectures SQL sont simulées ; elles sont prouvées sur PostgreSQL
// (tests/integration/grille-sql.test.ts) et par le contrat de parité.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyserSerieQuotidienne } from "../../packages/stats/src/serie-quotidienne";
import { jourDecale } from "../../packages/stats/src/tendance";

const lectures = vi.hoisted(() => ({
  dailyVitalsSeries: vi.fn(),
  listDeploys: vi.fn(),
  fuseauDe: vi.fn(async () => "Europe/Paris"),
  constatsDeLaPeriode: vi.fn(),
}));

vi.mock("@/lib/queries-grid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-grid")>()),
  dailyVitalsSeries: lectures.dailyVitalsSeries,
}));
vi.mock("@/lib/queries-deploys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-deploys")>()),
  listDeploys: lectures.listDeploys,
}));
vi.mock("@/lib/fuseau", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/fuseau")>()),
  fuseauDe: lectures.fuseauDe,
}));
vi.mock("@/lib/queries-detections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-detections")>()),
  constatsDeLaPeriode: lectures.constatsDeLaPeriode,
}));

// Les implémentations, telles que le service `api` les compile (la console ne fait que
// transmettre : voir « la transmission », plus bas).
import { GET as TENDANCES } from "../../apps/console/lib/api/service/trends";
import { GET as DETECTIONS } from "../../apps/console/lib/api/service/detections";
import { creerTransmission } from "../../apps/console/lib/api/service-seul";
import { detectionDe, detectionsDe, lireEntite } from "../../apps/console/lib/api/detections";
import { RESERVE_COINCIDENCE, tendancesDesVitals, type JourLu } from "../../apps/console/lib/api/tendances";
import { THRESHOLDS } from "../../apps/console/lib/rating";
import type { Constat } from "../../apps/console/lib/queries-detections";

const JOURS = Array.from({ length: 14 }, (_v, i) => jourDecale("2026-09-16", i));

/** LCP : une marche de 1 900 à 2 800 ms au 8ᵉ jour (22/09), 200 mesures par jour. */
const LCP: JourLu[] = JOURS.map((jour, i) => ({ jour, p75: i < 6 ? 1900 + (i % 3) * 10 : 2800 + (i % 3) * 10, n: 200 }));
/** INP : quatre jours mesurés seulement. */
const INP: JourLu[] = JOURS.map((jour, i) => (i >= 10 ? { jour, p75: 180, n: 50 } : { jour, p75: null, n: 0 }));
/** Un vital sans aucune mesure : quatorze jours vides. */
const vide = (): JourLu[] => JOURS.map((jour) => ({ jour, p75: null, n: 0 }));
const SERIES = { LCP, INP, CLS: vide(), FCP: vide(), TTFB: vide() };

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

beforeEach(() => {
  process.env.CONSOLE_API_TOKENS = "global,tok-a@app-a";
  lectures.dailyVitalsSeries.mockResolvedValue(SERIES);
  lectures.listDeploys.mockResolvedValue([{ id: 1, ts: "2026-09-22T08:00:00Z", version: "1.4.2", env: "prod", source: "ci" }]);
});
afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  vi.clearAllMocks();
});

describe("tendancesDesVitals — les cinq vitals, un seul calcul", () => {
  const deploiements = [{ jour: "2026-09-22", version: "1.4.2" }];
  const rendu = tendancesDesVitals(SERIES, deploiements, "Europe/Paris");

  it("les cinq vitals, dans l'ordre de la console, avec leur borne « Bon » lue dans lib/rating.ts", () => {
    expect(rendu.vitals.map((v) => v.nom)).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);
    for (const v of rendu.vitals) expect(v.borneBon).toBe(THRESHOLDS[v.nom][0]);
    expect(rendu.vitals.find((v) => v.nom === "CLS")?.unite).toBe("score");
    expect(rendu.fenetre).toEqual({ jours: 14, du: "2026-09-16", au: "2026-09-29", fuseau: "Europe/Paris", journeeEnCours: "exclue" });
  });

  it("chaque vital est ce que rend analyserSerieQuotidienne sur sa série — la fonction de l'écran", () => {
    for (const v of rendu.vitals) {
      const a = analyserSerieQuotidienne(
        SERIES[v.nom].map((j) => ({ jour: j.jour, valeur: j.p75, effectif: j.n })),
        { borne: THRESHOLDS[v.nom][0], deploiements },
      );
      expect(v.tendance.etat).toBe(a.tendance.etat);
      expect(v.tendance.pente).toBe(a.tendance.fit?.slope ?? null);
      expect(v.echeance).toEqual(a.echeance);
      expect(v.rupture).toEqual(a.datation);
      expect(v.deploiement).toEqual(a.deploiement);
    }
  });

  it("LCP : rupture datée au 22/09, déploiement coïncident, réserve écrite ; dépassement déjà mesuré", () => {
    const lcp = rendu.vitals[0];
    expect(lcp.rupture.ok && lcp.rupture.rupture?.jour).toBe("2026-09-22");
    expect(lcp.deploiement).toEqual({ jour: "2026-09-22", version: "1.4.2" });
    expect(lcp.phrase).toContain("Le LCP p75 a changé de niveau autour du 22/09");
    expect(lcp.phrase).toContain(RESERVE_COINCIDENCE);
    expect(lcp.echeance).toMatchObject({ etat: "depasse", dans: 0, jour: "2026-09-29", borne: 2500 });
  });

  it("INP : quatre jours mesurés — ni droite ni datation, et ce qui manque est dit EN CHIFFRES", () => {
    const inp = rendu.vitals[1];
    expect(inp.tendance).toMatchObject({ etat: "insuffisante", joursValides: 4, joursRequis: 7, pente: null });
    expect(inp.echeance.etat).toBe("non_ecrit");
    expect(inp.rupture).toEqual({
      ok: false,
      raison: "datation non tentée : 4 jours valides, 10 requis",
      manque: { requis: 10, observe: 4, unite: "jours valides" },
    });
    expect(inp.phrase).toBe("INP p75 — datation non tentée : 4 jours valides, 10 requis.");
  });

  it("un vital muet garde ses quatorze jours vides : jamais 0, jamais une série absente", () => {
    const cls = rendu.vitals[2];
    expect(cls.serie).toHaveLength(14);
    expect(cls.serie.every((j) => j.p75 === null && j.n === 0)).toBe(true);
    expect(cls.tendance.courant).toBeNull();
  });
});

describe("GET /api/v1/trends", () => {
  it("rend l'enveloppe { meta, data } et lit les cinq vitals sur 14 jours complets", async () => {
    const reponse = await TENDANCES(requete("/trends?app=app-a&device=mobile"), contexte);
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(corps.data.vitals).toHaveLength(5);
    const [filtres, noms, options] = lectures.dailyVitalsSeries.mock.calls[0];
    expect(noms).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);
    expect(options).toEqual({ exclureAujourdhui: true });
    expect(filtres.device).toBe("mobile");
    // Le marqueur est ramené au jour de l'app avant d'être comparé à la rupture.
    expect(corps.data.vitals[0].deploiement).toEqual({ jour: "2026-09-22", version: "1.4.2" });
  });

  it.each(["period=7d", "from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z"])(
    "fenêtre fixe : ?%s est refusé (400 range_not_applicable), jamais ignoré",
    async (query) => {
      const reponse = await TENDANCES(requete(`/trends?${query}`), contexte);
      expect(reponse.status).toBe(400);
      expect(await reponse.json()).toMatchObject({ code: "range_not_applicable" });
      expect(lectures.dailyVitalsSeries).not.toHaveBeenCalled();
    },
  );
});

// ───────────────────────────────── Détections ─────────────────────────────────

const CONSTAT: Constat = {
  id: 7,
  appId: "app-a",
  detecteur: "plage",
  entite: "vital:LCP|route:/checkout",
  debut: "2026-09-29T12:00:00.000Z",
  fin: null,
  statut: "ouvert",
  priorite: 0.42,
  phrase: "LCP p75 de /checkout à 3,1 s depuis 14:00, contre 2,2 s habituellement le lundi à cette heure (3,4 écarts robustes, 312 mesures).",
  methode: { nom: "plage habituelle saisonnière", niveau: "hebdomadaire", legende: "même heure, même jour, 3 à 6 dernières semaines" },
  preuves: {
    vital: "LCP",
    route: "/checkout",
    heure: "2026-09-29T13:00:00.000Z",
    p75: 3100,
    p75_bas: 2900,
    p75_haut: 3300,
    n: 312,
    mediane_habituelle: 2200,
    plage_bas: 1700,
    plage_haut: 2800,
    z: 3.4,
    ecart_relatif: 0.409,
    niveau: "hebdomadaire",
  },
  impact: { part_mesures: 0.3, mesures: 312, mesures_total: 1040 },
};

describe("detectionDe — la forme d'un constat, sans rien recalculer", () => {
  it("la plage habituelle et l'heure qui fait preuve, lues dans les preuves du scheduler", () => {
    expect(detectionDe(CONSTAT)).toMatchObject({
      id: 7,
      app: "app-a",
      vital: "LCP",
      route: "/checkout",
      fin: null,
      plageHabituelle: { mediane: 2200, bas: 1700, haut: 2800, niveau: "hebdomadaire", legende: "même heure, même jour, 3 à 6 dernières semaines" },
      observe: { heure: "2026-09-29T13:00:00.000Z", p75: 3100, p75Bas: 2900, p75Haut: 3300, n: 312, z: 3.4, ecartRelatif: 0.409 },
    });
  });

  it("un constat sans preuve de plage n'invente pas de plage", () => {
    const d = detectionDe({ ...CONSTAT, detecteur: "rupture", entite: "vital:INP", preuves: {} });
    expect(d).toMatchObject({ vital: "INP", route: null, plageHabituelle: null, observe: null });
  });

  it("lireEntite : toutes routes = route null", () => {
    expect(lireEntite("vital:LCP")).toEqual({ vital: "LCP", route: null });
    expect(lireEntite("vital:CLS|route:/a|b")).toEqual({ vital: "CLS", route: "/a" });
  });

  it("table absente : `absent`, ni une erreur ni « aucun épisode » ; limite atteinte : `tronque`", () => {
    expect(detectionsDe({ etat: "absent" }, 50)).toMatchObject({ etat: "absent", detections: [], tronque: false });
    expect(detectionsDe({ etat: "ok", constats: [CONSTAT] }, 1)).toMatchObject({ etat: "ok", tronque: true });
    expect(detectionsDe({ etat: "ok", constats: [CONSTAT] }, 50).tronque).toBe(false);
  });
});

describe("GET /api/v1/detections", () => {
  // Un bloc, pas une expression : une fonction rendue par `beforeEach` serait
  // appelée comme nettoyage, et compterait pour un appel de la lecture.
  beforeEach(() => {
    lectures.constatsDeLaPeriode.mockResolvedValue({ etat: "ok", constats: [CONSTAT] });
  });

  it("lit la période du contrat, bornée à 100 constats, et rend la règle et la population", async () => {
    const reponse = await DETECTIONS(requete("/detections?app=app-a&period=7d&limit=500"), contexte);
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.data.detections[0].plageHabituelle.mediane).toBe(2200);
    expect(corps.data.limite).toBe(100);
    expect(corps.data.population).toContain("robots compris");
    const [query, limite] = lectures.constatsDeLaPeriode.mock.calls[0];
    expect(limite).toBe(100);
    expect(query.scope.effectiveApps).toEqual(["app-a"]);
    expect(query.range.preset).toBe("7d");
  });

  it.each([
    ["device=mobile", "device"],
    ["browser=Firefox", "browser"],
    ["route=/checkout", "route"],
  ])("?%s ne découpe pas un constat : 400 unsupported_dimension, avant toute lecture", async (query, dimension) => {
    const reponse = await DETECTIONS(requete(`/detections?${query}`), contexte);
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toMatchObject({ code: "unsupported_dimension", dimension });
    expect(lectures.constatsDeLaPeriode).not.toHaveBeenCalled();
  });
});

// ───────────────────────── La transmission de la console ─────────────────────────
//
// Les deux routes sont servies par le service `api` SEUL : le fichier de route de la
// console ne fait que transmettre (aucun chemin local, donc aucune lecture de base —
// cliquet C-R). Ce qui est verrouillé ici : ce qui part, ce qui revient, et ce qui
// n'est jamais rendu pour la réponse du service.
describe("la transmission — une route servie par le service seul", () => {
  const SERVICE = "https://api.mip.test";
  const signe = (corps: unknown, status = 200, entetes: Record<string, string> = {}) =>
    new Response(JSON.stringify(corps), { status, headers: { "x-mip-api": "1", etag: 'W/"abc"', "content-type": "application/json", ...entetes } });
  const req = (entetes: Record<string, string>, chemin = "/api/v1/trends?app=app-a&device=mobile") =>
    new Request(`https://console.test${chemin}`, { headers: entetes });

  it("au jeton : la requête part au service, chemin et paramètres intacts, sans cookie ; la réponse revient telle quelle", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => signe({ meta: {}, data: { vitals: [] } }));
    const transmettre = creerTransmission({ env: () => ({ CONSOLE_API_RELAY_URL: SERVICE }), fetch: fetch as never });
    const reponse = await transmettre(req({ authorization: "Bearer tok", cookie: "mip_session=x", "if-none-match": 'W/"old"' }));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("etag")).toBe('W/"abc"');
    expect(await reponse.json()).toEqual({ meta: {}, data: { vitals: [] } });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SERVICE}/api/v1/trends?app=app-a&device=mobile`);
    const entetes = new Headers(init.headers);
    expect(entetes.get("authorization")).toBe("Bearer tok");
    expect(entetes.get("if-none-match")).toBe('W/"old"');
    expect(entetes.get("cookie")).toBeNull();
  });

  it("les refus du service (400, 403, 304) reviennent tels quels : c'est lui qui parle", async () => {
    for (const status of [400, 403]) {
      const fetch = vi.fn(async () => signe({ error: "refus", code: "range_not_applicable" }, status));
      const transmettre = creerTransmission({ env: () => ({ CONSOLE_API_RELAY_URL: SERVICE }), fetch: fetch as never });
      expect((await transmettre(req({ authorization: "Bearer tok" }))).status).toBe(status);
    }
  });

  it("une session de la console : 401, rien ne part — le service ne vérifie pas les sessions", async () => {
    const fetch = vi.fn();
    const transmettre = creerTransmission({ env: () => ({ CONSOLE_API_RELAY_URL: SERVICE }), fetch: fetch as never });
    const reponse = await transmettre(req({ cookie: "mip_session=x" }));
    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toMatchObject({ code: "jeton_requis" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("service non configuré, injoignable, non signé ou en 5xx : 503 à rejouer — jamais une lecture locale", async () => {
    const sansUrl = creerTransmission({ env: () => ({}), fetch: vi.fn() as never });
    expect((await sansUrl(req({ authorization: "Bearer tok" }))).status).toBe(503);
    // Le jeton ne part jamais en clair hors de la machine.
    const enClair = creerTransmission({ env: () => ({ CONSOLE_API_RELAY_URL: "http://api.mip.test" }), fetch: vi.fn() as never });
    expect((await enClair(req({ authorization: "Bearer tok" }))).status).toBe(503);
    for (const fetch of [
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      vi.fn(async () => new Response("Application not found", { status: 404 })),
      vi.fn(async () => signe({ error: "erreur interne" }, 500)),
    ]) {
      const transmettre = creerTransmission({ env: () => ({ CONSOLE_API_RELAY_URL: SERVICE }), fetch: fetch as never });
      const reponse = await transmettre(req({ authorization: "Bearer tok" }));
      expect(reponse.status).toBe(503);
      expect(reponse.headers.get("retry-after")).toBe("5");
    }
  });
});
