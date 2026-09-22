// Écran /forecast (F55), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent :
//   · le ton de « LCP p75 actuel » est le verdict de `rating2026` (bon / à améliorer
//     / mauvais), jamais un seuil binaire à 2,5 s — 3 s n'est pas « mauvais » ;
//   · sans valeur (« — »), la tuile reste neutre : une absence n'est pas « bonne » ;
//   · une lecture en échec (F02, `lire()`) ne remplace pas tout l'écran par
//     `error.tsx` : la partie qui en dépend dit « lecture en échec », le reste s'affiche.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dailyTraffic, dailyLcpSeries } = vi.hoisted(() => ({
  dailyTraffic: vi.fn(),
  dailyLcpSeries: vi.fn(),
}));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic, dailyLcpSeries }));
vi.mock("@/lib/page-filters", () => ({
  pageFilters: async () => ({ ok: true, filters: { app: "demo", period: "24h", device: null, segment: [], includeBots: false } }),
}));
// Le hero est remplacé par une trace de ses props : le test lit le TON passé à
// chaque tuile, pas une classe de couleur (les jetons de couleur évoluent à part).
vi.mock("@/components/SupervisionHero", () => ({
  SupervisionHero: ({ children }: { children: ReactNode }) => <section data-hero="">{children}</section>,
  HeroStat: ({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) => (
    <div data-hero-stat={String(label)} data-tone={tone ?? "neutral"}>
      {value}
    </div>
  ),
  HeroReading: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/charts/ForecastChart", () => ({ ForecastChart: () => <div data-graphe="" /> }));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé : l'état « erreur »
// est remplacé par une trace de son titre. `lire()` journalise : canal simulé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));

const { default: Forecast } = await import("@/app/forecast/page");

const JOURS = Array.from({ length: 14 }, (_v, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const trafic = () => JOURS.map((day) => ({ day, pageviews: 100, errors: 2 }));
const lcpPlat = (p75: number) => JOURS.map((bucket) => ({ bucket, p75 }));

async function rendre(): Promise<string> {
  return renderToStaticMarkup(await Forecast({ searchParams: Promise.resolve({}) }));
}

function tonDe(html: string, libelle: string): string | null {
  const m = html.match(new RegExp(`data-hero-stat="${libelle}" data-tone="(\\w+)"`));
  return m ? m[1] : null;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  dailyTraffic.mockReset();
  dailyLcpSeries.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/forecast — lecture en échec (F02)", () => {
  it("trafic illisible : l'écran rend son en-tête et « lecture en échec », pas error.tsx", async () => {
    dailyTraffic.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    dailyLcpSeries.mockResolvedValue(lcpPlat(3000));
    const html = await rendre();
    expect(html).toContain("Prévisions");
    expect(html).toContain('data-echec="');
    // Rien n'est dessiné sur un axe qu'on n'a pas lu : ni hero, ni cartes.
    expect(html).not.toContain("data-hero");
    expect(html).not.toContain("Pas assez d&#x27;historique");
  });

  it("LCP illisible : la partie LCP dit « lecture en échec », erreurs et trafic restent affichés", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockRejectedValue(new Error("statement timeout"));
    const html = await rendre();
    expect(html).toMatch(/data-echec="[^"]*LCP/);
    expect(html).not.toContain("data-hero");
    // Pas de synthèse « stable » calculée sur un LCP qu'on n'a pas lu.
    expect(html).not.toContain("Synthèse");
    expect(html).toContain("Occurrences d&#x27;erreurs pour 100 pages vues");
    expect(html).toContain("Trafic (pages vues / j)");
  });
});

describe("/forecast — ton de « LCP p75 actuel »", () => {
  it("suit rating2026 : ≤ 2,5 s bon, ≤ 4 s à améliorer, au-delà mauvais", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    for (const [p75, ton] of [
      [2000, "good"],
      [2500, "good"],
      [3000, "warn"],
      [4000, "warn"],
      [4500, "poor"],
    ] as const) {
      dailyLcpSeries.mockResolvedValue(lcpPlat(p75));
      expect(tonDe(await rendre(), "LCP p75 actuel"), `${p75} ms`).toBe(ton);
    }
  });

  it("aucune mesure LCP : « — » en ton neutre, jamais vert", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue([]);
    const html = await rendre();
    expect(tonDe(html, "LCP p75 actuel")).toBe("neutral");
  });
});
