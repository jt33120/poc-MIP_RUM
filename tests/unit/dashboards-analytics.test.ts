// P6.5 — cartes analytiques d'un tableau de bord : fenêtre, intersection des
// filtres, parallélisme borné, cache court et export CSV.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries", () => ({ slowRoutes: vi.fn(), vitalsP75: vi.fn() }));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic: vi.fn() }));
vi.mock("@/lib/queries-frustration", () => ({ topFrustrations: vi.fn() }));
vi.mock("@/lib/queries-errors", () => ({ listErrorGroups: vi.fn() }));
vi.mock("@/lib/queries-events", () => ({ eventCount: vi.fn() }));
vi.mock("@/lib/queries-explorer", () => ({ exploreAnalytics: vi.fn() }));

import { exploreAnalytics, type ExplorerResult } from "@/lib/queries-explorer";
import { normalizeLayout, type AnalyticsWidget, type Widget } from "@/lib/dashboards";
import { filtersOfQuery } from "@/lib/filters";
import { parseAnalyticsQuery, type AnalyticsQuery } from "@/lib/query-contract";
import {
  CSV_MAX_ROWS,
  WIDGET_CONCURRENCY,
  csvCell,
  forgetWidgetCache,
  layoutToCsv,
  resolveWidget,
  resolveWidgets,
  widgetQuery,
  widgetRange,
  type WidgetData,
} from "@/lib/widget-data";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN = { role: "admin" as const, apps: null };

function requete(qs: string): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal: ADMIN, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

const ANALYSE = {
  schemaVersion: 2,
  type: "analytics",
  title: "Erreurs par release",
  query: {
    version: 1,
    dataset: "errors",
    measure: { aggregation: "sum", field: "occurrences" },
    filters: [{ field: "browser", operator: "eq", type: "string", value: "Firefox" }],
    groupBy: ["release"],
    limit: 10,
  },
  visualization: "toplist",
  filters: [{ field: "os", operator: "eq", type: "string", value: "iOS" }],
};

const carte = (over: Record<string, unknown> = {}): AnalyticsWidget =>
  normalizeLayout([{ ...ANALYSE, ...over }])[0] as AnalyticsWidget;

const RESULTAT: ExplorerResult = {
  meta: {
    app: "app-a", period: "24h", query_version: 1, effective_apps: ["app-a"],
    range: { from: "", to: "", preset: "24h", bucket_seconds: 3600 },
    dataset: "errors", measure: "occurrences", unit: "occurrences", aggregation: "sum",
    additive: true, counting: "occurrences reçues", source: "raw", group_by: ["release"],
    visualization: "toplist", warnings: [], coverage: { status: "complete", reason: null },
    truncated_groups: false, query: {},
  },
  data: {
    total: 41, samples: 41,
    groups: [
      { key: ["1.2.0"], value: 38, samples: 38 },
      { key: [null], value: 3, samples: 3 },
    ],
    series: [], rows: [], next_cursor: null,
  },
};

beforeEach(() => {
  forgetWidgetCache();
  vi.mocked(exploreAnalytics).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("widgetRange — la carte hérite, sauf override explicite", () => {
  const ecran = requete("period=7d").range;

  it("sans override, la carte suit la fenêtre de l'écran", () => {
    expect(widgetRange(null, ecran, NOW)).toEqual({ ok: true, range: ecran, own: false });
  });

  it("un preset propre est résolu sur l'horloge du rendu, et signalé comme propre", () => {
    const r = widgetRange({ preset: "1h" }, ecran, NOW);
    expect(r.ok && r.own).toBe(true);
    expect(r.ok && r.range.preset).toBe("1h");
    expect(r.ok && r.range.to).toBe(new Date(NOW).toISOString());
  });

  it("une fenêtre figée invalide est un diagnostic, jamais un repli silencieux", () => {
    // `to` après l'heure du serveur : la carte le DIT au lieu de mesurer autre chose.
    const futur = widgetRange(
      { from: "2026-09-17T11:00:00.000Z", to: "2026-09-18T11:00:00.000Z" },
      ecran,
      NOW,
    );
    expect(futur.ok).toBe(false);
    expect(futur.ok === false && futur.reason).toMatch(/fenêtre propre invalide/);
  });
});

describe("widgetQuery — les filtres s'ajoutent, ils ne remplacent jamais", () => {
  it("intersecte les filtres de l'AST ET ceux de la carte avec ceux de l'écran", () => {
    const ecran = requete("app=app-a&device=mobile&seg=v2:country:eq:FR");
    const q = widgetQuery(carte(), ecran, ecran.range);
    // Le filtre de l'écran survit, ceux de la carte s'ajoutent.
    expect(q.filters.device).toBe("mobile");
    expect(q.filters.segments).toEqual([
      { dimension: "country", operator: "eq", value: "FR" },
      { dimension: "browser", operator: "eq", value: "Firefox" },
      { dimension: "os", operator: "eq", value: "iOS" },
    ]);
    expect(q.scope.effectiveApps).toEqual(["app-a"]);
  });

  it("une carte n'ÉLARGIT pas la population : ses drapeaux ne font que restreindre", () => {
    const ecran = requete("app=app-a");
    const avecRobots = carte({ query: { ...ANALYSE.query, includeBots: true } });
    // L'écran exclut les robots : la carte ne peut pas les rouvrir.
    expect(widgetQuery(avecRobots, ecran, ecran.range).filters.includeBots).toBe(false);
    // L'écran les inclut ET la carte aussi : alors seulement ils entrent.
    const ouvert = requete("app=app-a&bots=1");
    expect(widgetQuery(avecRobots, ouvert, ouvert.range).filters.includeBots).toBe(true);
    // L'écran les inclut mais pas la carte : la carte reste la plus stricte.
    expect(widgetQuery(carte(), ouvert, ouvert.range).filters.includeBots).toBe(false);
  });
});

describe("résolution d'une carte analytique", () => {
  const ctx = () => ({
    filters: filtersOfQuery(requete("app=app-a")),
    timeZone: "Europe/Paris",
    nowMs: NOW,
  });

  it("rend un classement, avec ses groupes et « Inconnu » pour une valeur absente", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(RESULTAT);
    const data = await resolveWidget(carte(), ctx());
    expect(data.kind).toBe("toplist");
    expect(data.ranks).toEqual([
      { label: "1.2.0", value: 38, display: "38", sub: "38 lignes" },
      { label: "Inconnu", value: 3, display: "3", sub: "3 lignes" },
    ]);
    expect(data.filtersLabel).toBe("Navigateur = Firefox · Système = iOS");
    // Sans override, aucune fenêtre propre n'est annoncée sur la carte.
    expect(data.rangeLabel).toBeUndefined();
  });

  it("annonce la fenêtre PROPRE d'une carte qui en porte une", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(RESULTAT);
    const data = await resolveWidget(carte({ rangeOverride: { preset: "7d" } }), ctx());
    expect(data.rangeLabel).toBeTruthy();
  });

  it("une carte illisible devient un diagnostic, jamais une carte vide", async () => {
    const [invalide] = normalizeLayout([{ type: "venu_du_futur" }]);
    const data = await resolveWidget(invalide, ctx());
    expect(data.kind).toBe("invalid");
    expect(data.reason).toMatch(/type de widget inconnu/);
    expect(exploreAnalytics).not.toHaveBeenCalled();
  });

  it("un budget dépassé n'affiche AUCUN chiffre : une série de zéros se lirait comme du calme", async () => {
    const { ExplorerBudgetError } = await import("@/lib/analytics-schema");
    vi.mocked(exploreAnalytics).mockRejectedValue(new ExplorerBudgetError());
    const data = await resolveWidget(carte(), ctx());
    expect(data.kind).toBe("error");
    expect(data.reason).toMatch(/budget de lecture dépassé/i);
    expect(data.ranks).toBeUndefined();
  });

  it("n'empile une série QUE si la mesure s'additionne", async () => {
    const serie = (additive: boolean): ExplorerResult => ({
      meta: { ...RESULTAT.meta, additive, visualization: "timeseries", aggregation: additive ? "sum" : "p95" },
      data: {
        ...RESULTAT.data,
        groups: [],
        series: [
          { start: "2026-09-17T10:00:00.000Z", end: "", key: ["a"], value: 1, samples: 1 },
          { start: "2026-09-17T10:00:00.000Z", end: "", key: ["b"], value: 2, samples: 1 },
          { start: "2026-09-17T11:00:00.000Z", end: "", key: ["a"], value: 3, samples: 1 },
        ],
      },
    });
    const temporelle = carte({ visualization: "timeseries", query: { ...ANALYSE.query, limit: 5 } });

    vi.mocked(exploreAnalytics).mockResolvedValue(serie(true));
    const additive = await resolveWidget(temporelle, ctx());
    expect(additive.series?.stacked).toBe(true);
    expect(additive.series?.buckets).toHaveLength(2);
    expect(additive.series?.groups.map((g) => g.label)).toEqual(["a", "b"]);
    // Un seau sans mesure vaut zéro pour une agrégation additive.
    expect(additive.series?.groups[1].values).toEqual([2, 0]);

    forgetWidgetCache();
    vi.mocked(exploreAnalytics).mockResolvedValue(serie(false));
    const percentile = await resolveWidget(temporelle, ctx());
    expect(percentile.series?.stacked).toBe(false);
    expect(percentile.notes?.join(" ")).toMatch(/non additive/);
  });
});

describe("chargement de la grille", () => {
  const ctx = () => ({
    filters: filtersOfQuery(requete("app=app-a")),
    timeZone: "Europe/Paris",
    nowMs: NOW,
  });

  it("ne lance jamais plus de quatre lectures à la fois, et rend dans l'ordre de la grille", async () => {
    let enCours = 0;
    let maximum = 0;
    vi.mocked(exploreAnalytics).mockImplementation(async () => {
      enCours += 1;
      maximum = Math.max(maximum, enCours);
      await new Promise((r) => setTimeout(r, 1));
      enCours -= 1;
      return RESULTAT;
    });
    // Douze cartes DISTINCTES : le cache ne doit pas masquer le parallélisme.
    const grille: Widget[] = Array.from({ length: 12 }, (_, i) =>
      carte({ title: `c${i}`, query: { ...ANALYSE.query, limit: i + 1 } }),
    );
    const data = await resolveWidgets(grille, ctx());

    expect(data).toHaveLength(12);
    expect(maximum).toBeLessThanOrEqual(WIDGET_CONCURRENCY);
    expect(exploreAnalytics).toHaveBeenCalledTimes(12);
  });

  it("une annulation n'ouvre pas les lectures restantes, et le DIT carte par carte", async () => {
    const controleur = new AbortController();
    controleur.abort();
    const grille: Widget[] = [carte(), carte({ title: "b" })];
    const data = await resolveWidgets(grille, { ...ctx(), signal: controleur.signal });
    expect(exploreAnalytics).not.toHaveBeenCalled();
    expect(data.every((d) => d.kind === "error")).toBe(true);
    expect(data[0].reason).toMatch(/annulée/);
  });

  it("deux cartes identiques ne posent la question qu'une fois (cache court, portée incluse)", async () => {
    vi.mocked(exploreAnalytics).mockResolvedValue(RESULTAT);
    await resolveWidgets([carte(), carte()], ctx());
    expect(exploreAnalytics).toHaveBeenCalledTimes(1);

    // Autre périmètre : la réponse de A ne peut pas servir à B.
    const autre = {
      filters: filtersOfQuery(requete("app=app-b")),
      timeZone: "Europe/Paris",
      nowMs: NOW,
    };
    await resolveWidget(carte(), autre);
    expect(exploreAnalytics).toHaveBeenCalledTimes(2);
  });
});

describe("export CSV", () => {
  it("désamorce une cellule qui commencerait une formule de tableur", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+33612345678")).toBe("'+33612345678");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@import")).toBe("'@import");
    // Guillemets, virgules et points-virgules restent traités par RFC 4180.
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=SUM(A1);2")).toBe("\"'=SUM(A1);2\"");
    expect(csvCell("normal")).toBe("normal");
  });

  it("annonce la troncature au plafond, plutôt que de rendre un inventaire partiel muet", () => {
    const grosse: WidgetData = {
      kind: "table",
      columns: ["n"],
      rows: Array.from({ length: CSV_MAX_ROWS + 10 }, (_, i) => [i]),
    };
    const widgets = normalizeLayout([{ type: "traffic", title: "Trafic" }, { type: "frustration" }]);
    const csv = layoutToCsv("Ops", widgets, [grosse, grosse], new Date("2026-09-17T12:00:00.000Z"));
    expect(csv).toMatch(/Export tronqué au plafond de 10000 lignes/);
    // Le plafond est GLOBAL : la seconde carte n'a plus de budget.
    expect(csv.split("\n").filter((l) => /^\d+$/.test(l))).toHaveLength(CSV_MAX_ROWS);
  });

  it("écrit la fenêtre propre, les filtres et les avertissements d'une carte", () => {
    const data: WidgetData = {
      kind: "toplist",
      value: "41 occurrences",
      rangeLabel: "7 j",
      filtersLabel: "Navigateur = Firefox",
      notes: ["Résultat partiel : rétention dépassée."],
      ranks: [{ label: "1.2.0", value: 38, display: "38", sub: "38 lignes" }],
    };
    const csv = layoutToCsv("Ops", normalizeLayout([{ type: "traffic" }]), [data], new Date());
    expect(csv).toContain("7 j");
    expect(csv).toContain("filtres : Navigateur = Firefox");
    expect(csv).toContain("Résultat partiel : rétention dépassée.");
    expect(csv).toContain("1.2.0,38,38 lignes");
  });
});
