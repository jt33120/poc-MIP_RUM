// Écran /paths (F50, § 5.13 ; sur le contrat depuis F53), rendu côté serveur avec
// des lectures simulées.
//
// Ce que ces tests verrouillent (en plus de l'e2e `usages-parcours.spec.ts`) :
//   · AUCUNE part n'est calculée sur un top N — la part se lit sur
//     `sessionsAvecVue` (B31), et sa lecture en échec rend « — », jamais « 0 % » ;
//   · les deux tables de bords ont les mêmes colonnes, dans le même ordre ;
//   · l'ancrage `depuis` (B31) : les nœuds de gauche et la rangée « À partir de »
//     ancrent le flux, sans toucher aux tuiles ; les étapes typées (B33) restent
//     annoncées absentes ;
//   · l'entonnoir nomme ses deux taux et encadre la plus forte perte ;
//   · une lecture en échec n'efface pas les autres blocs.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery } from "@/lib/query-contract";

const { routeTransitions, entryExitRoutes, lcpDesRoutes, availableEvents, funnelReport, samplingSessions, sessionsAvecVue } =
  vi.hoisted(() => ({
    routeTransitions: vi.fn(),
    entryExitRoutes: vi.fn(),
    lcpDesRoutes: vi.fn(),
    availableEvents: vi.fn(),
    funnelReport: vi.fn(),
    samplingSessions: vi.fn(),
    sessionsAvecVue: vi.fn(),
  }));
vi.mock("@/lib/queries-paths", () => ({ routeTransitions, entryExitRoutes, lcpDesRoutes }));
vi.mock("@/lib/queries-funnel", () => ({ availableEvents, funnelReport }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessions }));
vi.mock("@/lib/queries", () => ({ sessionsAvecVue }));
vi.mock("@/lib/comparaison", () => ({
  couverturePrecedente: async () => ({ etat: "complete", raison: null }),
  sourcesSousFiltres: (_q: unknown, s: unknown) => [s],
}));

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const QUERY = (() => {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=demo&period=7d"), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
})();
vi.mock("@/lib/page-filters", () => ({
  pageFilters: async () => ({
    ok: true,
    filters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false, query: QUERY },
    deviceFilters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false, query: QUERY },
    query: QUERY,
    label: "7 j",
    bucketLabel: "6 h",
    notApplied: null,
  }),
}));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé : l'état « erreur »
// est remplacé par une trace de son titre. `lire()` journalise : canal simulé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));

const { default: Paths } = await import("@/app/paths/page");

const transition = (from_route: string, to_route: string, n: number) => ({ from_route, to_route, n });
const route = (route: string, n: number, une_vue = 0) => ({ route, n, une_vue });

async function rendre(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Paths({ searchParams: Promise.resolve(sp) }));
}

/** Le texte visible, sans balises ni entités d'espace. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const m of [routeTransitions, entryExitRoutes, lcpDesRoutes, availableEvents, funnelReport, samplingSessions, sessionsAvecVue])
    m.mockReset();
  routeTransitions.mockImplementation(async (_f: unknown, _n: unknown, o?: { depuis?: string }) =>
    o?.depuis === "/panier"
      ? [transition("/panier", "/paiement", 3), transition("/panier", "/aide", 1)]
      : o?.depuis
        ? []
        : [transition("/", "/panier", 8), transition("/panier", "/paiement", 3)],
  );
  entryExitRoutes.mockResolvedValue({
    entries: [route("/", 12, 5), route("/panier", 4)],
    exits: [route("/paiement", 9), route("/", 7, 5)],
  });
  sessionsAvecVue.mockResolvedValue(16);
  lcpDesRoutes.mockResolvedValue([{ route: "/", p75: 2100, n: 40 }]);
  availableEvents.mockResolvedValue([{ name: "checkout", n: 30, sessions: 12 }]);
  funnelReport.mockResolvedValue([]);
  samplingSessions.mockResolvedValue({ probaMin: 1, sessions: 10, sansTaux: 0, biaiseErreurs: false });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/paths — la part se lit sur les sessions avec vue (B31), jamais sur un top N", () => {
  it("les tuiles de bord donnent la route, son compte et sa part de toutes les sessions avec vue", async () => {
    const t = texte(await rendre());
    expect(t).toContain("Page d'entrée n°1 / · 12 sessions sur 16 75,0 % des sessions avec vue y démarrent.");
    expect(t).toContain("Page de sortie n°1 /paiement · 9 sessions sur 16 56,3 % des sessions avec vue s'y terminent.");
    expect(t).not.toContain("dénominateur à créer");
  });

  it("les deux tables ont les mêmes colonnes ; part, sessions à une vue et LCP p75 remplis", async () => {
    const html = await rendre();
    const entrees = html.slice(html.indexOf('id="paths-entrees"'), html.indexOf('id="paths-sorties"'));
    const sorties = html.slice(html.indexOf('id="paths-sorties"'));
    const colonnes = (bloc: string) => [...bloc.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());
    expect(colonnes(entrees)).toEqual(["Route", "Sessions", "Part de toutes les sessions", "Sessions à une vue", "LCP p75 de la route"]);
    expect(colonnes(sorties)).toEqual(colonnes(entrees));
    // « / » : 12 sur 16 = 75 %, 5 sessions à une vue, LCP p75 2,1 s ; « /panier » sans mesure → « — ».
    expect(texte(entrees)).toMatch(/\/ Ouvrir \/pages 12 75,0 % 5 2,1 s/);
    expect(texte(entrees)).toMatch(/\/panier Ouvrir \/pages 4 25,0 % 0 —/);
    expect(entrees).toContain('title="aucune mesure LCP de cette route sur la plage"');
    // La route mène aux sessions passées par elle (recherche exacte), et à /pages.
    expect(entrees).toContain("/sessions?app=demo&amp;period=7d&amp;qf=route&amp;q=%2Fpanier");
    expect(entrees).toContain("/pages?app=demo&amp;period=7d&amp;route=%2Fpanier");
    // Le LCP est lu pour les routes des deux tables, sur la même requête.
    expect(lcpDesRoutes).toHaveBeenCalledWith(expect.anything(), ["/", "/panier", "/paiement"]);
  });

  it("dénominateur illisible : part « — » et raison, jamais une part sur les routes affichées", async () => {
    sessionsAvecVue.mockRejectedValue(new Error("boum"));
    const html = await rendre();
    const t = texte(html);
    expect(t).toContain("part non calculée : le nombre de sessions avec vue n'a pas pu être lu");
    const entrees = html.slice(html.indexOf('id="paths-entrees"'), html.indexOf('id="paths-sorties"'));
    expect(texte(entrees)).not.toMatch(/\d+(,\d+)?\s?%/);
  });

  it("la carte « Transitions les plus fréquentes » a disparu : le flux porte son alternative", async () => {
    const html = await rendre();
    expect(texte(html)).not.toContain("Transitions les plus fréquentes");
    const flux = html.slice(html.indexOf('id="paths-flux"'), html.indexOf('data-testid="paths-ancrage"'));
    expect(flux).toContain('data-testid="alternative"');
    expect(texte(flux)).toContain("De Vers Sessions");
  });
});

describe("/paths — ancrage `depuis` (B31)", () => {
  it("sans ancrage : les nœuds de gauche et la rangée « À partir de » proposent l'ancrage, étapes gardées", async () => {
    const html = await rendre({ s1: "vue", s2: "achat" });
    expect(html).toContain('data-testid="paths-ancrage"');
    expect(texte(html)).toContain("À partir de : Toutes les routes / /panier");
    // Un nœud de gauche ancre, en gardant les étapes de l'entonnoir.
    expect(html).toMatch(/href="\/paths\?app=demo&amp;period=7d&amp;depuis=%2F&amp;s1=vue&amp;s2=achat"/);
    expect(texte(html)).not.toContain("ancrage « à partir de » à créer");
    expect(routeTransitions).toHaveBeenCalledTimes(1);
  });

  it("ancré : le flux ne dessine que les départs de la route, les tuiles ne changent pas", async () => {
    const html = await rendre({ depuis: "/panier" });
    expect(routeTransitions).toHaveBeenCalledWith(expect.anything(), 50, { depuis: "/panier" });
    const flux = html.slice(html.indexOf('id="paths-flux"'), html.indexOf('data-testid="paths-ancrage"'));
    expect(texte(flux)).toContain("Flux à partir de /panier");
    expect(texte(flux)).toContain("/aide");
    // Les tuiles lisent toujours toutes les transitions (réglage d'écran : aucun chiffre ne change).
    expect(texte(html)).toMatch(/Transitions distinctes 2 /);
    // « Toutes les routes » retire l'ancrage.
    expect(html).toMatch(/data-testid="paths-ancrage-toutes"[^>]*href="\/paths\?app=demo&amp;period=7d"|href="\/paths\?app=demo&amp;period=7d"[^>]*data-testid="paths-ancrage-toutes"/);
  });

  it("ancré sur une route sans départ : vide motivé, sans geste d'élargissement", async () => {
    const html = await rendre({ depuis: "/nulle-part" });
    expect(texte(html)).toContain("Aucune transition à partir de /nulle-part sur les 7 derniers jours.");
  });
});

describe("/paths — patchs backend absents (§ 0.5) et contrat (F53)", () => {
  it("étapes typées (B33) annoncées, jamais rendues inertes", async () => {
    const t = texte(await rendre());
    expect(t).toContain("étapes de type vue ou action à créer : seuls les événements custom sont proposés comme étapes (B33)");
  });

  it("plus de « lecture non migrée » : la méta de chaque figure écrit la plage du contrat", async () => {
    const html = await rendre();
    expect(html).not.toContain("lecture non migrée");
    expect(texte(html)).not.toContain("glissant");
    const metas = html.match(/data-testid="figure-meta"[^]*?<\/div>/g) ?? [];
    expect(metas).toHaveLength(4); // flux, entrées, sorties, entonnoir
    for (const m of metas) expect(m).toContain("7 j");
    expect(samplingSessions).toHaveBeenCalledWith(expect.anything(), { population: { lecture: "vues" } });
  });

  it("le sélecteur annonce le volume de chaque événement", async () => {
    expect(texte(await rendre())).toContain("checkout (12 sessions)");
  });

  it("cmp=prev : la tuile « Transitions distinctes » se compare ; plafond précédent → écart tu", async () => {
    routeTransitions.mockImplementation(async (_f: unknown, _n: unknown, o?: { shift?: boolean }) =>
      o?.shift ? [transition("/", "/panier", 8)] : [transition("/", "/panier", 8), transition("/panier", "/paiement", 3)],
    );
    expect(texte(await rendre({ cmp: "prev" }))).toMatch(/Transitions distinctes 2 ↑ \+100 % vs 7 jours précédents/);
    routeTransitions.mockImplementation(async (_f: unknown, _n: unknown, o?: { shift?: boolean }) =>
      o?.shift ? Array.from({ length: 50 }, (_, i) => transition(`/a${i}`, `/b${i}`, 1)) : [transition("/", "/panier", 8)],
    );
    expect(texte(await rendre({ cmp: "prev" }))).toContain(
      "période précédente incomplète : plafond de 50 transitions atteint sur la période précédente : son compte est un minimum",
    );
  });
});

describe("/paths — entonnoir", () => {
  const ETAPES = [
    { ord: 1, name: "vue", reached: 100, convFromStart: 1, convFromPrev: 1, dropoff: 0 },
    { ord: 2, name: "panier", reached: 40, convFromStart: 0.4, convFromPrev: 0.4, dropoff: 60 },
    { ord: 3, name: "achat", reached: 22, convFromStart: 0.22, convFromPrev: 0.55, dropoff: 18 },
  ];

  it("deux taux nommés par étape, abandon en nombre, plus forte perte encadrée", async () => {
    funnelReport.mockResolvedValue(ETAPES);
    const html = await rendre({ s1: "vue", s2: "panier", s3: "achat" });
    const t = texte(html);
    expect(t).toContain("55,0 % de l'étape précédente");
    expect(t).toContain("22,0 % du départ");
    expect(t).toContain("−60 sessions");
    expect(t).toContain("plus forte perte");
    // L'encadré est sur l'étape 2 (60 perdues), pas sur l'étape 3 (18).
    const etapes = [...html.matchAll(/data-testid="funnel-etape"([^>]*)>/g)].map((m) => m[1]);
    expect(etapes).toHaveLength(3);
    expect(etapes[1]).toContain('data-pire="1"');
    expect(etapes[0] + etapes[2]).not.toContain('data-pire="1"');
    // « Voir au Journal » porte le nom de l'étape.
    expect(html).toContain("/events?app=demo&amp;period=7d&amp;kind=event&amp;name=achat");
  });

  it("départ à 0 : taux « — », jamais « 0 % », et la note le dit", async () => {
    funnelReport.mockResolvedValue([
      { ord: 1, name: "vue", reached: 0, convFromStart: null, convFromPrev: null, dropoff: 0 },
      { ord: 2, name: "panier", reached: 0, convFromStart: null, convFromPrev: null, dropoff: 0 },
    ]);
    const t = texte(await rendre({ s1: "vue", s2: "panier" }));
    expect(t).toContain("— du départ");
    expect(t).toContain("— de l'étape précédente");
    expect(t).toContain("Aucune session n'a réalisé l'étape 1 sur les 7 derniers jours");
    expect(t).not.toContain("plus forte perte");
  });
});

describe("/paths — lectures en échec et vides", () => {
  it("les transitions en échec n'effacent ni les tuiles de bord ni l'entonnoir", async () => {
    routeTransitions.mockRejectedValue(new Error("boum"));
    const html = await rendre();
    expect(html).toContain('data-echec="Flux entre routes"');
    const t = texte(html);
    expect(t).toContain("Page d'entrée n°1 / · 12 sessions sur 16");
    expect(t).toContain("Transitions distinctes — lecture des transitions en échec");
    expect(t).toContain("Entonnoir de conversion");
  });

  it("aucune transition : état vide motivé, aucun dessin", async () => {
    routeTransitions.mockResolvedValue([]);
    const html = await rendre();
    expect(texte(html)).toContain("Aucune transition entre deux routes sur les 7 derniers jours.");
    const flux = html.slice(html.indexOf('id="paths-flux"'), html.indexOf('id="paths-entrees"'));
    expect(flux).not.toContain("<svg");
  });

  it("50 transitions renvoyées : « ≥ 50 », jamais « 50 » (S4)", async () => {
    routeTransitions.mockResolvedValue(Array.from({ length: 50 }, (_, i) => transition(`/a${i}`, `/b${i}`, 50 - i)));
    expect(texte(await rendre())).toContain("Transitions distinctes ≥ 50");
  });
});
