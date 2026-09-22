// Écran /forecast (F55), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent :
//   · le ton de « LCP p75 actuel » est le verdict de `rating2026` (bon / à améliorer
//     / mauvais), jamais un seuil binaire à 2,5 s — 3 s n'est pas « mauvais » ;
//   · sans valeur (« — »), la tuile reste neutre : une absence n'est pas « bonne ».
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  dailyTraffic.mockReset();
  dailyLcpSeries.mockReset();
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
