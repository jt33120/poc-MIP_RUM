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

import { normalizeLayout, widgetQueryJson, type AnalyticsWidget } from "@/lib/dashboards";
import { explorerHrefFromAst } from "@/lib/explorer-page-params";
import { filtersOfQuery } from "@/lib/filters";
import { dailyTraffic } from "@/lib/queries-grid";
import { vitalsP75 } from "@/lib/queries";
import { exploreAnalytics, type ExplorerResult } from "@/lib/queries-explorer";
import { parseAnalyticsQuery } from "@/lib/query-contract";
import {
  COMPARAISON_HORS_FORME,
  RAISON_LECTURE_INDISPONIBLE,
  forgetWidgetCache,
  layoutToCsv,
  resolveWidget,
  type WidgetData,
} from "@/lib/widget-data";
// F37 — plafond de l'export (import du lot).
import { CSV_MAX_ROWS as F37_CSV_MAX_ROWS } from "@/lib/widget-data";

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

// ─────────────────────────────── F36 — cartes ───────────────────────────────
//
// Ce que ces tests empêchent :
//   - qu'une carte transporte une chaîne déjà formatée (« 2,7 s ») au lieu du
//     nombre : le rendu ne pourrait plus ni comparer, ni noter, ni exporter ;
//   - qu'une moyenne ou un p95 de LCP reçoive un verdict Web Vitals (R-V, CE13) ;
//   - qu'un vital sans mesure et un percentile non calculable se disent tous les
//     deux « aucune donnée » (CE4) ;
//   - qu'une absence devienne « 0 » dans le CSV exporté ;
//   - qu'un classement ou une série prétendent comparer deux périodes.

/** Une carte v2 « Valeur », sans regroupement — la seule forme qui se compare (W-B2). */
const carteValeurF36 = (measure: { aggregation: string; field: string }): AnalyticsWidget =>
  normalizeLayout([
    {
      schemaVersion: 2,
      type: "analytics",
      title: "LCP",
      query: { version: 1, dataset: "vitals", variant: "LCP", measure, filters: [], groupBy: [], limit: 1 },
      visualization: "value",
      filters: [],
    },
  ])[0] as AnalyticsWidget;

/** Résultat d'une carte « Valeur » : un total, un effectif, aucune ventilation. */
const resultatValeurF36 = (total: number | null, samples = 120, aggregation = "p75"): ExplorerResult => ({
  meta: {
    app: "app-a", period: "24h", query_version: 1, effective_apps: ["app-a"],
    range: { from: "2026-09-16T12:00:00.000Z", to: "2026-09-17T12:00:00.000Z", preset: "24h", bucket_seconds: 3600 },
    dataset: "vitals", measure: "value", unit: "ms", aggregation,
    additive: false, counting: "mesures", source: "raw", group_by: [],
    visualization: "value", warnings: [], coverage: { status: "complete", reason: null },
    truncated_groups: false, query: {},
  },
  data: { total, samples, groups: [], series: [], rows: [], next_cursor: null },
});

describe("F36 — une carte transporte des NOMBRES, jamais des chaînes formatées", () => {
  it("carte « Valeur » : total, effectif, format et vital de verdict ; aucun texte mis en forme", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(resultatValeurF36(2450));
    const data = await resolveWidget(carteValeurF36({ aggregation: "p75", field: "value" }), ctx());
    expect(data.total).toBe(2450);
    expect(data.samples).toBe(120);
    expect(data.format).toBe("ms");
    expect(data.unit).toBe("ms");
    // R-V : un p75 de LCP porte bien un verdict.
    expect(data.vital).toBe("LCP");
    expect(data.sansVerdict).toBeUndefined();
    // Le résultat brut voyage tel quel : `ResultatAnalyse` est la seule traduction.
    expect(data.analyse?.plan.visualization).toBe("value");
    expect(data.analyse?.data.total).toBe(2450);
    // Aucune chaîne « 2 450 ms » n'a été fabriquée dans la donnée de la carte.
    expect(JSON.stringify(data)).not.toContain("2 450");
  });

  it("CE13 / R-V : une MOYENNE de LCP n'a aucun verdict, et la carte dit pourquoi", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(resultatValeurF36(1800, 90, "avg"));
    const data = await resolveWidget(carteValeurF36({ aggregation: "avg", field: "value" }), ctx());
    expect(data.vital).toBeUndefined();
    expect(data.sansVerdict).toMatch(/aucun verdict n'est donné pour la moyenne/);
  });

  it("CE13 / R-V : un p95 de LCP non plus", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(resultatValeurF36(4100, 90, "p95"));
    const data = await resolveWidget(carteValeurF36({ aggregation: "p95", field: "value" }), ctx());
    expect(data.vital).toBeUndefined();
    expect(data.sansVerdict).toMatch(/le p95/);
  });
});

describe("F36 — CE4 : trois états distincts pour une carte v1 « <Vital> p75 »", () => {
  it("n = 0 → « aucune mesure de LCP sur 24 h », jamais « aucune donnée »", async () => {
    vi.mocked(vitalsP75).mockResolvedValue([
      { name: "LCP", p75: null, p50: 0, n: 0, intervalle: { etat: "indisponible", raison: "0 mesure" } },
    ] as unknown as Awaited<ReturnType<typeof vitalsP75>>);
    const [lcp] = normalizeLayout([{ type: "vital_p75", metric: "LCP", title: "LCP" }]);
    const data = await resolveWidget(lcp, ctx());
    expect(data.total).toBeNull();
    expect(data.samples).toBe(0);
    expect(data.raisonNull).toBe("aucune mesure de LCP sur 24 h");
    expect(data.vital).toBe("LCP");
  });

  it("n > 0 mais p75 non calculable → « percentile non calculable », pas la même chose", async () => {
    vi.mocked(vitalsP75).mockResolvedValue([
      { name: "LCP", p75: null, p50: 0, n: 7, intervalle: { etat: "indisponible", raison: "7 mesures" } },
    ] as unknown as Awaited<ReturnType<typeof vitalsP75>>);
    const [lcp] = normalizeLayout([{ type: "vital_p75", metric: "LCP", title: "LCP" }]);
    const data = await resolveWidget(lcp, ctx());
    expect(data.total).toBeNull();
    expect(data.samples).toBe(7);
    expect(data.raisonNull).toBe("percentile non calculable");
  });

  it("valeur mesurée : le nombre et son effectif, verdict permis (c'est un p75)", async () => {
    vi.mocked(vitalsP75).mockResolvedValue([
      { name: "LCP", p75: 2450, p50: 1800, n: 320, intervalle: { etat: "indisponible", raison: "—" } },
    ] as unknown as Awaited<ReturnType<typeof vitalsP75>>);
    const [lcp] = normalizeLayout([{ type: "vital_p75", metric: "LCP", title: "LCP" }]);
    const data = await resolveWidget(lcp, ctx());
    expect(data).toMatchObject({ kind: "value", total: 2450, samples: 320, format: "ms", vital: "LCP" });
    expect(data.raisonNull).toBeUndefined();
  });
});

describe("F36 — cmp=prev : les cartes « Valeur » seulement", () => {
  it("une carte « Valeur » relit la période précédente et porte son total", async () => {
    vi.mocked(exploreAnalytics)
      .mockResolvedValueOnce(resultatValeurF36(2450))
      .mockResolvedValueOnce(resultatValeurF36(2100, 110));
    const data = await resolveWidget(carteValeurF36({ aggregation: "p75", field: "value" }), {
      ...ctx(),
      comparaison: "prev",
    });
    expect(exploreAnalytics).toHaveBeenCalledTimes(2);
    expect(data.analyse?.precedent?.total).toBe(2100);
    expect(data.analyse?.precedent?.couverture.etat).toBe("complete");
    expect(data.analyse?.precedent?.plage).toMatch(/^vs 24 h précédentes/);
  });

  it("un classement n'est PAS comparé, et la carte le dit", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(resultat({ additive: false, groups: [{ key: ["Chrome"], value: 2400, samples: 120 }] }));
    const data = await resolveWidget(carte("toplist"), { ...ctx(), comparaison: "prev" });
    // Une seule lecture : aucune période précédente n'est ouverte pour rien.
    expect(exploreAnalytics).toHaveBeenCalledTimes(1);
    expect(data.analyse?.precedent).toBeUndefined();
    expect(data.notes?.join(" ")).toContain(COMPARAISON_HORS_FORME);
  });
});

describe("F36 — « Ouvrir dans l'Explorer » : le JSON d'une carte se relit", () => {
  // Aller-retour exigé par le plan avant d'utiliser le lien : si le registre
  // refusait le JSON d'une carte v2, le bouton mènerait à un Explorer en erreur.
  it("explorerHrefFromAst accepte le JSON d'une carte v2, avec ses conditions", () => {
    const w = normalizeLayout([
      {
        schemaVersion: 2,
        type: "analytics",
        title: "Occurrences par route",
        query: {
          version: 1,
          dataset: "errors",
          measure: { aggregation: "sum", field: "occurrences" },
          filters: [{ field: "release", operator: "eq", type: "string", value: "1.2.0" }],
          groupBy: ["route"],
          limit: 5,
        },
        visualization: "toplist",
        filters: [],
      },
    ])[0] as AnalyticsWidget;
    const lu = explorerHrefFromAst(widgetQueryJson(w));
    expect(lu.ok).toBe(true);
    if (lu.ok) {
      const sp = new URLSearchParams(lu.href.split("?")[1]);
      expect(sp.get("dataset")).toBe("errors");
      expect(sp.get("measure")).toBe("occurrences:sum");
      expect(sp.get("g0")).toBe("route");
      expect(sp.get("seg")).toContain("release");
      expect(sp.get("run")).toBe("1");
      // ÉCART RELEVÉ (§ 0.5) : `widgetQueryJson` n'écrit PAS la représentation —
      // `serializeLayout` la range hors de l'AST, à côté de lui. Relu seul, l'AST
      // retombe donc sur « Valeur ». La carte ne s'en sert pas comme adresse :
      // elle s'en sert comme PORTE (le registre relit-il ce JSON ?) et bâtit son
      // lien sur `widget.plan`, qui porte la représentation enregistrée.
      expect(sp.get("viz")).toBe("value");
    }
  });

  it("un AST illisible rend sa RAISON : la carte n'affiche pas un lien mort", () => {
    const lu = explorerHrefFromAst({ version: 1, dataset: "licornes" });
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.reason).toBeTruthy();
  });
});

describe("F36 — export CSV : une absence reste une absence", () => {
  it("total non calculable → cellule VIDE et sa raison, jamais « 0 »", () => {
    const data: WidgetData = {
      kind: "value",
      total: null,
      samples: 0,
      format: "ms",
      unit: "ms",
      raisonNull: "aucune mesure de LCP sur 24 h",
    };
    const csv = layoutToCsv("Perf", normalizeLayout([{ type: "vital_p75", metric: "LCP" }]), [data], new Date(NOW));
    expect(csv).toContain("Valeur,Effectif,Raison de l’absence");
    expect(csv).toContain(",0,aucune mesure de LCP sur 24 h");
    expect(csv).not.toMatch(/^0,0,/m);
  });

  it("groupe sans valeur calculable → cellule VIDE, jamais « 0 » ni « — »", () => {
    const data: WidgetData = {
      kind: "toplist",
      ranks: [
        { label: "Chrome", value: 2400, display: "2 400", sub: "120 lignes" },
        { label: "Safari", value: null, display: "—", sub: "0 lignes" },
      ],
    };
    const csv = layoutToCsv("Perf", normalizeLayout([{ type: "traffic" }]), [data], new Date(NOW));
    expect(csv).toContain("Chrome,2400,120 lignes");
    expect(csv).toContain("Safari,,0 lignes");
    expect(csv).not.toContain("Safari,0,");
  });
});

// F37 (W-B12) — un titre de section ne mesure rien : aucune lecture, aucune
// connexion prise ; dans l'export, un intertitre qui ne consomme pas le plafond.
describe("F37 — titre de section : aucune lecture, un intertitre dans l'export", () => {
  it("resolveWidget d'une section : aucune lecture lancée", async () => {
    const [section] = normalizeLayout([{ type: "section", title: "Où ?", question: "Où les pages sont-elles lentes ?" }]);
    expect(await resolveWidget(section, ctx())).toEqual({ kind: "section" });
    expect(exploreAnalytics).not.toHaveBeenCalled();
    expect(vitalsP75).not.toHaveBeenCalled();
    expect(dailyTraffic).not.toHaveBeenCalled();
  });

  it("export CSV : « # Section : titre — question », à sa place, sans ligne de donnée", () => {
    const layout = normalizeLayout([
      { type: "section", title: "Où ?", question: "Où les pages sont-elles lentes ?" },
      { type: "traffic", title: "Trafic" },
      { type: "section", title: "Qui ?" },
    ]);
    const table: WidgetData = { kind: "table", columns: ["Jour", "Pages vues"], rows: [["2026-09-17", 12]] };
    const csv = layoutToCsv("Perf", layout, [{ kind: "section" }, table, { kind: "section" }], new Date(NOW));
    expect(csv).toContain("# Section : Où ? — Où les pages sont-elles lentes ?");
    // Question vide : le titre seul, sans tiret pendant.
    expect(csv).toMatch(/^# Section : Qui \?$/m);
    expect(csv).toContain("2026-09-17,12");
    expect(csv.indexOf("# Section : Où ?")).toBeLessThan(csv.indexOf("# Trafic"));
    expect(csv.indexOf("# Trafic")).toBeLessThan(csv.indexOf("# Section : Qui ?"));
  });

  it("export au plafond : un titre de section restant n'est pas une carte manquante", () => {
    const pleine: WidgetData = { kind: "table", columns: ["n"], rows: Array.from({ length: F37_CSV_MAX_ROWS }, (_, i) => [i]) };
    const section = { kind: "section" } as const;
    const sansCarteApres = normalizeLayout([{ type: "traffic", title: "Trafic" }, { type: "section", title: "Qui ?" }]);
    expect(layoutToCsv("Perf", sansCarteApres, [pleine, section], new Date(NOW))).not.toMatch(/Export tronqué/);
    // Une CARTE restante, elle, manque au fichier : la troncature est annoncée.
    const avecCarteApres = normalizeLayout([{ type: "traffic" }, { type: "section", title: "Qui ?" }, { type: "frustration" }]);
    expect(layoutToCsv("Perf", avecCarteApres, [pleine, section, pleine], new Date(NOW))).toMatch(/Export tronqué/);
  });
});
