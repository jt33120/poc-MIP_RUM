// Écran /paths (F50, § 5.13), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent (en plus de l'e2e `usages-parcours.spec.ts`) :
//   · AUCUNE part n'est calculée sur un top N — la colonne « Part de toutes les
//     sessions » existe, reste vide et dit pourquoi (preuve de fin du lot) ;
//   · les deux tables de bords ont les mêmes colonnes, dans le même ordre ;
//   · l'ancrage du Sankey (B31) et les étapes typées (B33) sont annoncés absents,
//     jamais rendus inertes ;
//   · l'entonnoir nomme ses deux taux et encadre la plus forte perte ;
//   · une lecture en échec n'efface pas les autres blocs.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeTransitions, entryExitRoutes, availableEvents, funnelReport, samplingSessionsHistorique } = vi.hoisted(
  () => ({
    routeTransitions: vi.fn(),
    entryExitRoutes: vi.fn(),
    availableEvents: vi.fn(),
    funnelReport: vi.fn(),
    samplingSessionsHistorique: vi.fn(),
  }),
);
vi.mock("@/lib/queries-paths", () => ({ routeTransitions, entryExitRoutes }));
vi.mock("@/lib/queries-funnel", () => ({ availableEvents, funnelReport }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessionsHistorique }));
vi.mock("@/lib/page-filters", () => ({
  pageFilters: async () => ({
    ok: true,
    filters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false },
    query: {
      scope: { requestedApp: "demo" },
      range: { preset: "7d", from: "", to: "" },
      filters: { device: null, segments: [], includeBots: false, includeInternal: false },
    },
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
const route = (route: string, n: number) => ({ route, n });

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
  for (const m of [routeTransitions, entryExitRoutes, availableEvents, funnelReport, samplingSessionsHistorique])
    m.mockReset();
  routeTransitions.mockResolvedValue([transition("/", "/panier", 8), transition("/panier", "/paiement", 3)]);
  entryExitRoutes.mockResolvedValue({
    entries: [route("/", 12), route("/panier", 4)],
    exits: [route("/paiement", 9), route("/", 7)],
  });
  availableEvents.mockResolvedValue([{ name: "checkout", n: 30, sessions: 12 }]);
  funnelReport.mockResolvedValue([]);
  samplingSessionsHistorique.mockResolvedValue({ probaMin: 1, sessions: 10, sansTaux: 0, biaiseErreurs: false });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/paths — aucune part calculée sur un top N", () => {
  it("les tuiles de bord donnent la route et son compte, jamais une part", async () => {
    const t = texte(await rendre());
    expect(t).toContain("Page d'entrée n°1 / · 12 sessions y démarrent");
    expect(t).toContain("Page de sortie n°1 /paiement · 9 sessions s'y terminent");
    expect(t).toContain("part de l'ensemble non calculée (dénominateur à créer)");
    // Aucun « x sur y » ni pourcentage dans les tuiles : le dénominateur n'est pas lu.
    const tuiles = t.slice(t.indexOf("Page d'entrée n°1"), t.indexOf("Transitions distinctes"));
    expect(tuiles).not.toMatch(/%/);
  });

  it("les deux tables ont les mêmes colonnes et une part vide et motivée", async () => {
    const html = await rendre();
    const entrees = html.slice(html.indexOf('id="paths-entrees"'), html.indexOf('id="paths-sorties"'));
    const sorties = html.slice(html.indexOf('id="paths-sorties"'));
    const colonnes = (bloc: string) => [...bloc.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());
    expect(colonnes(entrees)).toEqual(["Route", "Sessions", "Part de toutes les sessions"]);
    expect(colonnes(sorties)).toEqual(colonnes(entrees));
    // Aucune cellule de part chiffrée, dans l'une comme dans l'autre.
    for (const bloc of [entrees, sorties]) {
      expect(bloc).toContain('title="part de l&#x27;ensemble non calculée (dénominateur à créer)"');
      expect(texte(bloc)).not.toMatch(/\d+(,\d+)?\s?%/);
    }
    // La route mène aux sessions passées par elle (recherche exacte), et à /pages.
    expect(entrees).toContain("/sessions?app=demo&amp;period=7d&amp;qf=route&amp;q=%2Fpanier");
    expect(entrees).toContain("/pages?app=demo&amp;period=7d&amp;route=%2Fpanier");
  });

  it("la carte « Transitions les plus fréquentes » a disparu : le flux porte son alternative", async () => {
    const html = await rendre();
    expect(texte(html)).not.toContain("Transitions les plus fréquentes");
    const flux = html.slice(html.indexOf('id="paths-flux"'), html.indexOf('data-testid="paths-ancrage"'));
    expect(flux).toContain('data-testid="alternative"');
    expect(texte(flux)).toContain("De Vers Sessions");
  });
});

describe("/paths — patchs backend absents (§ 0.5)", () => {
  it("ancrage (B31) et étapes typées (B33) annoncés, jamais rendus inertes", async () => {
    const t = texte(await rendre());
    expect(t).toContain("ancrage « à partir de » à créer : la lecture des transitions ne filtre pas sur une route de départ (B31)");
    expect(t).toContain("étapes de type vue ou action à créer : seuls les événements custom sont proposés comme étapes (B33)");
  });

  it("lecture non migrée sous l'en-tête et dans la méta de chaque figure (S3)", async () => {
    const html = await rendre();
    expect(texte(html)).toMatch(
      /7 derniers jours glissants, lus à \d\d:\d\d UTC \(lecture non migrée : ni plage personnalisée, ni tablette, ni « Inconnu »\)/,
    );
    const metas = html.match(/data-testid="figure-meta"[^]*?<\/div>/g) ?? [];
    expect(metas).toHaveLength(4); // flux, entrées, sorties, entonnoir
    for (const m of metas) expect(m).toContain("lecture non migrée");
  });

  it("le sélecteur annonce le volume de chaque événement", async () => {
    expect(texte(await rendre())).toContain("checkout (12 sessions)");
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
    expect(t).toContain("Aucune session n'a réalisé l'étape 1 sur les 7 derniers jours glissants");
    expect(t).not.toContain("plus forte perte");
  });
});

describe("/paths — lectures en échec et vides", () => {
  it("les transitions en échec n'effacent ni les tuiles de bord ni l'entonnoir", async () => {
    routeTransitions.mockRejectedValue(new Error("boum"));
    const html = await rendre();
    expect(html).toContain('data-echec="Flux entre routes"');
    const t = texte(html);
    expect(t).toContain("Page d'entrée n°1 / · 12 sessions y démarrent");
    expect(t).toContain("Transitions distinctes — lecture des transitions en échec");
    expect(t).toContain("Entonnoir de conversion");
  });

  it("aucune transition : état vide motivé, aucun dessin", async () => {
    routeTransitions.mockResolvedValue([]);
    const html = await rendre();
    expect(texte(html)).toContain("Aucune transition entre deux routes sur les 7 derniers jours glissants.");
    const flux = html.slice(html.indexOf('id="paths-flux"'), html.indexOf('data-testid="paths-ancrage"'));
    expect(flux).not.toContain("<svg");
  });

  it("50 transitions renvoyées : « ≥ 50 », jamais « 50 » (S4)", async () => {
    routeTransitions.mockResolvedValue(Array.from({ length: 50 }, (_, i) => transition(`/a${i}`, `/b${i}`, 50 - i)));
    expect(texte(await rendre())).toContain("Transitions distinctes ≥ 50");
  });
});
