// Les hachures « non mesuré » branchées sur un écran (refonte du monitoring,
// vague 1, lot C) — ici /tracing, le même branchement vaut pour /pages, /errors,
// /sessions et /events.
//
// Ce que ces tests verrouillent :
//   · le CHARGEUR de l'écran lit les fenêtres hors collecte (`sectionFenetresCollecte`)
//     sur la période affichée ET la précédente, pour le périmètre de l'écran, en
//     une section à part ;
//   · la PAGE les passe au graphique temporel (`fenetresCollecte`) ;
//   · une lecture du registre en échec ne hachure rien et n'emporte pas la série :
//     la série garde sa section, le graphique reste dessiné.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bucketStarts, parseAnalyticsQuery, previousRange } from "@/lib/query-contract";
import { grilleIso, type FenetreCollecte } from "@/lib/series";

const m = vi.hoisted(() => ({
  lireFenetresCollecte: vi.fn(),
  analyserFiltres: vi.fn(),
  spanLatencySeries: vi.fn(),
  ecranLu: { courant: null as unknown },
}));

vi.mock("@/lib/queries-collecte", () => ({ lireFenetresCollecte: m.lireFenetresCollecte }));
vi.mock("@/lib/filtres-ecran", () => ({ analyserFiltres: m.analyserFiltres }));
vi.mock("@/lib/queries-tracing", async (original) => ({
  ...(await original<typeof import("@/lib/queries-tracing")>()),
  traceCoverage: async () => null,
  apiCallsDecomposition: async () => [],
  spanLatencySeries: m.spanLatencySeries,
  backRoutes: async () => [],
  slowTraces: async () => [],
}));
vi.mock("@/lib/queries-deploys", async (original) => ({
  ...(await original<typeof import("@/lib/queries-deploys")>()),
  listDeploys: async () => [],
  latestDeployImpact: async () => null,
}));
vi.mock("@/lib/queries-v2", async (original) => ({
  ...(await original<typeof import("@/lib/queries-v2")>()),
  alertEvents: async () => [],
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// La page lit l'écran par `chargerEcran` (session, aiguillage) : ici, la sortie du chargeur telle quelle.
vi.mock("@/lib/ecran", () => ({ chargerEcran: async () => m.ecranLu.courant }));
// La série (client, recharts) est remplacée par une trace de ses props.
vi.mock("@/components/charts/ThresholdSeries", async (original) => ({
  ...(await original<typeof import("@/components/charts/ThresholdSeries")>()),
  ThresholdSeries: (p: { ariaLabel: string; fenetresCollecte?: readonly FenetreCollecte[] }) => (
    <div
      data-graphe={p.ariaLabel}
      data-fenetres={p.fenetresCollecte === undefined ? "absentes" : p.fenetresCollecte.map((f) => `${f.etat}|${f.debut}|${f.fin}`).join(" ")}
    />
  ),
}));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const query = (() => {
  const p = parseAnalyticsQuery(new URLSearchParams("app=demo-app&period=24h"), {
    principal: { role: "admin", apps: null },
    nowMs: Date.now(),
  });
  if (!p.ok) throw new Error(p.error.code);
  return p.value;
})();
const grille = grilleIso(bucketStarts(query.range));

/** Une panne datée au milieu de la plage : une FIXTURE (en production, le registre `collecte_fenetre`). */
const FENETRE: FenetreCollecte = { debut: grille[3], fin: grille[6], etat: "interrompue", portee: "*" };
const echec = { ok: false, code: "lecture_en_echec" } as const;

const { chargerTracing } = await import("@/lib/chargeurs/tracing");
const { default: Tracing } = await import("@/app/tracing/page");

beforeEach(() => {
  m.lireFenetresCollecte.mockReset();
  m.lireFenetresCollecte.mockResolvedValue([FENETRE]);
  m.analyserFiltres.mockReset();
  m.analyserFiltres.mockResolvedValue({
    ok: true,
    filters: { app: "demo-app", period: "24h", device: null, segment: [], includeBots: false, query },
    query,
    label: "24 h",
    bucketLabel: "1 h",
  });
  m.spanLatencySeries.mockReset();
  m.spanLatencySeries.mockResolvedValue(grille.map((t) => ({ t, front_p75: 420, back_p75: 180, n: 40 })));
});

describe("chargeur /tracing — les fenêtres hors collecte, une section de plus", () => {
  it("lit la période affichée ET la précédente, pour le périmètre de l'écran", async () => {
    const sortie = await chargerTracing({ email: "a@b", role: "admin", apps: null } as never, { app: "demo-app" });
    if (sortie.etat !== "ok") throw new Error(sortie.etat);
    expect(m.lireFenetresCollecte).toHaveBeenCalledTimes(1);
    expect(m.lireFenetresCollecte).toHaveBeenCalledWith(
      { from: previousRange(query.range).from, to: query.range.to },
      query.scope.effectiveApps,
    );
    expect(sortie.fenetresCollecte).toEqual({ ok: true, data: [FENETRE] });
  });

  it("registre illisible : sa section est en échec, la série reste lue", async () => {
    m.lireFenetresCollecte.mockRejectedValue(new Error("statement timeout"));
    const sortie = await chargerTracing({ email: "a@b", role: "admin", apps: null } as never, { app: "demo-app" });
    if (sortie.etat !== "ok") throw new Error(sortie.etat);
    expect(sortie.fenetresCollecte.ok).toBe(false);
    expect(sortie.serie.ok).toBe(true);
  });
});

describe("page /tracing — la série de latence reçoit les fenêtres", () => {
  const lecture = (fenetresCollecte: unknown) => ({
    etat: "ok",
    query,
    label: "24 h",
    bucketLabel: "1 h",
    cov: echec,
    covPrec: { ok: true, data: null },
    couvAppels: [],
    couvDurees: [],
    appels: { ok: true, data: [] },
    serie: { ok: true, data: grille.map((t) => ({ t, front_p75: 420, back_p75: 180, n: 40 })) },
    seriePrec: { ok: true, data: null },
    routes: echec,
    lentes: echec,
    deploys: { ok: true, data: [] },
    impact: echec,
    alertes: { ok: true, data: [] },
    fenetresCollecte,
  });
  const rendre = async () => renderToStaticMarkup(await Tracing({ searchParams: Promise.resolve({ app: "demo-app" }) }));
  const fenetresDuGraphe = (html: string) => html.match(/data-graphe="Latence p75 des appels API[^"]*" data-fenetres="([^"]*)"/)?.[1];

  it("les fenêtres lues arrivent au graphique, datées", async () => {
    m.ecranLu.courant = lecture({ ok: true, data: [FENETRE] });
    const html = await rendre();
    expect(fenetresDuGraphe(html)).toBe(`interrompue|${FENETRE.debut}|${FENETRE.fin}`);
  });

  it("lecture du registre en échec : aucune hachure, le graphique reste dessiné", async () => {
    m.ecranLu.courant = lecture(echec);
    const html = await rendre();
    expect(fenetresDuGraphe(html)).toBe("absentes");
  });
});
