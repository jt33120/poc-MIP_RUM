// F30 — vérité des cartes de tableau de bord (CE1, CE2, CE3 ; date du widget
// « Trafic »). Ce que ces tests empêchent :
//   - qu'une heure sans mesure LCP soit dessinée « LCP = 0 ms », verdict « Bon » ;
//   - qu'un groupe sans valeur calculable devienne une barre à 0, lue « meilleur » ;
//   - qu'une base indisponible rende une table vide, lue « aucune ligne » ;
//   - qu'un jour de trafic s'écrive « Tue Sep 22 » (un `Date` de node-postgres
//     passé à `String(d).slice(0, 10)`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries", () => ({ slowRoutes: vi.fn(), vitalsP75: vi.fn() }));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic: vi.fn() }));
vi.mock("@/lib/queries-frustration", () => ({ topFrustrations: vi.fn() }));
vi.mock("@/lib/queries-errors", () => ({ listErrorGroups: vi.fn() }));
vi.mock("@/lib/queries-events", () => ({ eventCount: vi.fn() }));
vi.mock("@/lib/queries-explorer", () => ({ exploreAnalytics: vi.fn() }));

import { normalizeLayout, type AnalyticsWidget } from "@/lib/dashboards";
import { filtersOfQuery } from "@/lib/filters";
import { dailyTraffic } from "@/lib/queries-grid";
import { vitalsP75 } from "@/lib/queries";
import { exploreAnalytics, type ExplorerResult } from "@/lib/queries-explorer";
import { parseAnalyticsQuery } from "@/lib/query-contract";
import {
  RAISON_LECTURE_INDISPONIBLE,
  forgetWidgetCache,
  layoutToCsv,
  resolveWidget,
  type WidgetData,
} from "@/lib/widget-data";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function ctx() {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=app-a"), {
    principal: { role: "admin", apps: null },
    nowMs: NOW,
  });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return { filters: filtersOfQuery(parsed.value), timeZone: "Europe/Paris", nowMs: NOW };
}

const carte = (visualization: string, measure = { aggregation: "p75", field: "value" }): AnalyticsWidget =>
  normalizeLayout([
    {
      schemaVersion: 2,
      type: "analytics",
      title: "LCP par navigateur",
      query: { version: 1, dataset: "vitals", variant: "LCP", measure, filters: [], groupBy: ["browser"], limit: 5 },
      visualization,
      filters: [],
    },
  ])[0] as AnalyticsWidget;

const resultat = (over: { additive: boolean; groups?: ExplorerResult["data"]["groups"]; series?: ExplorerResult["data"]["series"] }): ExplorerResult => ({
  meta: {
    app: "app-a", period: "24h", query_version: 1, effective_apps: ["app-a"],
    range: { from: "", to: "", preset: "24h", bucket_seconds: 3600 },
    dataset: "vitals", measure: "value", unit: "ms", aggregation: over.additive ? "sum" : "p75",
    additive: over.additive, counting: "mesures", source: "raw", group_by: ["browser"],
    visualization: "timeseries", warnings: [], coverage: { status: "complete", reason: null },
    truncated_groups: false, query: {},
  },
  data: { total: null, samples: 3, groups: over.groups ?? [], series: over.series ?? [], rows: [], next_cursor: null },
});

const H10 = "2026-09-17T10:00:00.000Z";
const H11 = "2026-09-17T11:00:00.000Z";

beforeEach(() => {
  forgetWidgetCache();
  vi.mocked(exploreAnalytics).mockReset();
  vi.mocked(vitalsP75).mockReset();
  vi.mocked(dailyTraffic).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("CE1 — série : un seau sans mesure est un trou, pas un zéro", () => {
  it("mesure NON additive (p75) : groupe absent d'un seau → null ; valeur lue null → null", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(
      resultat({
        additive: false,
        series: [
          { start: H10, end: "", key: ["Chrome"], value: 1800, samples: 40 },
          { start: H10, end: "", key: ["Firefox"], value: null, samples: 0 },
          { start: H11, end: "", key: ["Chrome"], value: 2100, samples: 35 },
        ],
      }),
    );
    const data = await resolveWidget(carte("timeseries"), ctx());
    expect(data.series?.groups).toEqual([
      { label: "Chrome", values: [1800, 2100] },
      // Firefox : pas de p75 à 10 h (lu null), absent à 11 h → deux trous, jamais « 0 ms ».
      { label: "Firefox", values: [null, null] },
    ]);
  });

  it("mesure ADDITIVE : un groupe absent d'un seau y vaut 0 — là, zéro est la vérité", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(
      resultat({
        additive: true,
        series: [
          { start: H10, end: "", key: ["Chrome"], value: 4, samples: 4 },
          { start: H11, end: "", key: ["Firefox"], value: 2, samples: 2 },
        ],
      }),
    );
    const data = await resolveWidget(carte("timeseries", { aggregation: "count", field: "rows" }), ctx());
    expect(data.series?.groups.map((g) => g.values)).toEqual([
      [4, 0],
      [0, 2],
    ]);
  });

  it("export CSV : cellule VIDE pour un seau sans mesure, jamais « 0 »", () => {
    const data: WidgetData = {
      kind: "timeseries",
      series: { buckets: ["17/09 10:00", "17/09 11:00"], groups: [{ label: "Chrome", values: [null, 2100] }], stacked: false },
    };
    const csv = layoutToCsv("Perf", normalizeLayout([{ type: "traffic" }]), [data], new Date(NOW));
    expect(csv).toContain("17/09 10:00,\n");
    expect(csv).toContain("17/09 11:00,2100");
    expect(csv).not.toContain("17/09 10:00,0");
  });
});

describe("CE2 — classement : une valeur non calculable reste null, en fin de liste", () => {
  it("groupe à valeur null → value null, affiché « — », rangé après les groupes mesurés", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(
      resultat({
        additive: false,
        groups: [
          { key: ["Safari"], value: null, samples: 0 },
          { key: ["Chrome"], value: 2400, samples: 120 },
          { key: [null], value: 1900, samples: 8 },
        ],
      }),
    );
    const data = await resolveWidget(carte("toplist"), ctx());
    const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    expect(data.ranks).toEqual([
      { label: "Chrome", value: 2400, display: fr(2400), sub: "120 lignes" },
      { label: "Inconnu", value: 1900, display: fr(1900), sub: "8 lignes" },
      { label: "Safari", value: null, display: "—", sub: "0 lignes" },
    ]);
  });
});

describe("CE3 — carte v1 : une lecture qui lève devient une erreur dite", () => {
  it("vitalsP75 qui lève → kind « error », jamais une table vide", async () => {
    vi.mocked(vitalsP75).mockRejectedValue(new Error("connexion refusée"));
    const [lcp] = normalizeLayout([{ type: "vital_p75", metric: "LCP", title: "LCP" }]);
    const data = await resolveWidget(lcp, ctx());
    expect(data).toEqual({ kind: "error", reason: RAISON_LECTURE_INDISPONIBLE });
    // La raison technique n'est jamais affichée.
    expect(JSON.stringify(data)).not.toContain("connexion refusée");
  });
});

describe("widget « Trafic » : le jour est une date, pas « Tue Sep 22 »", () => {
  it("un `Date` rendu par node-postgres (minuit local) s'écrit AAAA-MM-JJ", async () => {
    vi.mocked(dailyTraffic).mockResolvedValue([
      { day: new Date(2026, 8, 22) as unknown as string, pageviews: 12, errors: 1 },
      { day: "2026-09-21" as string, pageviews: 3, errors: 0 },
    ] as Awaited<ReturnType<typeof dailyTraffic>>);
    const [trafic] = normalizeLayout([{ type: "traffic", title: "Trafic" }]);
    const data = await resolveWidget(trafic, ctx());
    expect(data.rows).toEqual([
      ["2026-09-22", 12, 1],
      ["2026-09-21", 3, 0],
    ]);
  });
});

describe("preuve de fin F30", () => {
  it("lib/widget-data.ts n'écrit plus « ?? 0 » nulle part", () => {
    const source = readFileSync(join(__dirname, "..", "..", "apps", "console", "lib", "widget-data.ts"), "utf8");
    expect(source).not.toMatch(/\?\?\s*0\b/);
  });
});
