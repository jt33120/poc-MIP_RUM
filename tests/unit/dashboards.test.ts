// Helpers purs des tableaux de bord (lib/dashboards.ts) : adaptateur de lecture
// v1/v2, sérialisation d'écriture et carte de diagnostic (P6.5).
import { describe, expect, it } from "vitest";
import {
  defaultTitle,
  MAX_WIDGETS,
  normalizeLayout,
  parseRangeOverride,
  serializeLayout,
  widgetFiltersLabel,
  widgetFromPlan,
  type AnalyticsWidget,
} from "../../apps/console/lib/dashboards";
import { parseExplorerPlan } from "../../apps/console/lib/analytics-schema";

/** Une configuration v2 telle qu'elle est stockée en jsonb. */
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

describe("normalizeLayout — adaptateur de lecture", () => {
  it("rejette une entrée non-array", () => {
    expect(normalizeLayout(null)).toEqual([]);
    expect(normalizeLayout({})).toEqual([]);
    expect(normalizeLayout("x")).toEqual([]);
  });

  it("garde les widgets v1 et TRANSFORME l'inconnu en diagnostic, sans le perdre", () => {
    const out = normalizeLayout([
      { type: "traffic", title: "Trafic" },
      { type: "inconnu", title: "x" },
      { type: "frustration" },
    ]);
    expect(out.map((w) => w.kind)).toEqual(["v1", "invalid", "v1"]);
    // La carte illisible dit POURQUOI, et conserve son JSON d'origine intact.
    expect(out[1]).toMatchObject({ kind: "invalid", title: "x" });
    expect(out[1].kind === "invalid" && out[1].reason).toMatch(/type de widget inconnu/);
    expect(out[1].kind === "invalid" && out[1].raw).toEqual({ type: "inconnu", title: "x" });
  });

  it("vital_p75 sans métrique valide devient un diagnostic ; avec métrique, un widget", () => {
    const sansMetrique = normalizeLayout([{ type: "vital_p75", title: "x" }]);
    expect(sansMetrique[0].kind).toBe("invalid");
    const mauvaise = normalizeLayout([{ type: "vital_p75", metric: "ZZZ" }]);
    expect(mauvaise[0].kind).toBe("invalid");
    const ok = normalizeLayout([{ type: "vital_p75", metric: "LCP" }]);
    expect(ok[0]).toMatchObject({ kind: "v1", type: "vital_p75", metric: "LCP", title: "LCP p75" });
  });

  it("titre par défaut si absent", () => {
    const [w] = normalizeLayout([{ type: "traffic" }]);
    expect(w.title).toBe(defaultTitle("traffic"));
  });

  it("event_count exige un nom borné et le conserve pour le rendu/export partagé", () => {
    expect(normalizeLayout([{ type: "event_count" }])[0].kind).toBe("invalid");
    expect(normalizeLayout([{ type: "event_count", eventName: "x".repeat(101) }])[0].kind).toBe("invalid");
    expect(normalizeLayout([{ type: "event_count", eventName: "checkout" }])[0]).toEqual({
      kind: "v1", type: "event_count", eventName: "checkout", title: "Événements · checkout",
    });
  });

  it("borne le nombre de widgets à MAX_WIDGETS", () => {
    const many = Array.from({ length: MAX_WIDGETS + 10 }, () => ({ type: "traffic" }));
    expect(normalizeLayout(many)).toHaveLength(MAX_WIDGETS);
  });

  it("tronque les titres trop longs", () => {
    const [w] = normalizeLayout([{ type: "traffic", title: "x".repeat(200) }]);
    expect(w.title.length).toBeLessThanOrEqual(60);
  });
});

describe("widget v2 — AST validé par le registre de l'Explorer", () => {
  it("lit une analyse complète : plan, filtres d'AST et filtres de carte séparés", () => {
    const [w] = normalizeLayout([ANALYSE]);
    expect(w.kind).toBe("v2");
    const analyse = w as AnalyticsWidget;
    expect(analyse.plan.dataset).toBe("errors");
    expect(analyse.plan.visualization).toBe("toplist");
    expect(analyse.plan.groupBy).toEqual(["release"]);
    expect(analyse.conditions).toEqual([{ dimension: "browser", operator: "eq", value: "Firefox" }]);
    expect(analyse.filters).toEqual([{ dimension: "os", operator: "eq", value: "iOS" }]);
    expect(analyse.rangeOverride).toBeNull();
    expect(widgetFiltersLabel(analyse)).toBe("Navigateur = Firefox · Système = iOS");
  });

  it("refuse une mesure, une dimension ou une représentation hors registre — avec sa raison", () => {
    const cas: Array<[unknown, RegExp]> = [
      [{ ...ANALYSE, query: { ...ANALYSE.query, dataset: "secrets" } }, /jeu de données inconnu/],
      [{ ...ANALYSE, query: { ...ANALYSE.query, measure: { aggregation: "p95", field: "occurrences" } }}, /p95|agr/i],
      [{ ...ANALYSE, visualization: "camembert" }, /représentation inconnue/],
      [{ ...ANALYSE, query: { ...ANALYSE.query, groupBy: ["mot_de_passe"] } }, /dimension/i],
      [{ ...ANALYSE, query: { ...ANALYSE.query, limit: 9999 } }, /limite|limit/i],
      [{ ...ANALYSE, inconnu: 1 }, /clé de widget inconnue/],
      [{ ...ANALYSE, query: { ...ANALYSE.query, version: 2 } }, /version d'AST non supportée/],
    ];
    for (const [config, motif] of cas) {
      const [w] = normalizeLayout([config]);
      expect(w.kind, JSON.stringify(config).slice(0, 80)).toBe("invalid");
      expect(w.kind === "invalid" && w.reason).toMatch(motif);
    }
  });

  it("borne le total des conditions d'une carte à celui du contrat", () => {
    const dix = Array.from({ length: 6 }, (_, i) => ({
      field: "release", operator: "eq", type: "string", value: `r${i}`,
    }));
    const [w] = normalizeLayout([{ ...ANALYSE, query: { ...ANALYSE.query, filters: dix }, filters: dix }]);
    expect(w.kind).toBe("invalid");
    expect(w.kind === "invalid" && w.reason).toMatch(/10 conditions/);
  });

  it("un curseur ne s'enregistre pas : une page n'est pas une analyse", () => {
    const plan = parseExplorerPlan(
      { dataset: "errors", measure: { aggregation: "sum", field: "occurrences" }, visualization: "table", cursor: "x".repeat(20) },
      null,
    );
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.error.code).toBe("invalid_cursor");
  });
});

describe("parseRangeOverride — fenêtre propre bornée", () => {
  it("accepte un preset ou deux instants UTC, refuse le reste", () => {
    expect(parseRangeOverride(null)).toEqual({ ok: true, value: null });
    expect(parseRangeOverride({ preset: "7d" })).toEqual({ ok: true, value: { preset: "7d" } });
    expect(parseRangeOverride({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" })).toEqual({
      ok: true,
      value: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" },
    });
    for (const mauvais of [
      { preset: "90d" },
      { preset: "7d", from: "2026-09-01T00:00:00.000Z" },
      { from: "2026-09-02T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      // Plus de 30 jours : la fenêtre d'une carte ne dépasse pas celle du contrat.
      { from: "2026-07-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      { from: "2026-09-01", to: "2026-09-02" },
      "24h",
    ]) {
      expect(parseRangeOverride(mauvais).ok, JSON.stringify(mauvais)).toBe(false);
    }
  });
});

describe("serializeLayout — chaque widget repart dans SA version", () => {
  it("n'ajoute aucune clé à un widget v1 : ouvrir un tableau ne le convertit pas", () => {
    const stocke = [{ type: "traffic", title: "Trafic" }, { type: "vital_p75", metric: "LCP", title: "LCP p75" }];
    expect(serializeLayout(normalizeLayout(stocke))).toEqual(stocke);
  });

  it("réécrit un widget illisible TEL QUEL — il n'est jamais effacé par une écriture", () => {
    const stocke = [{ type: "traffic", title: "Trafic" }, { type: "venu_du_futur", options: { x: 1 } }];
    expect(serializeLayout(normalizeLayout(stocke))).toEqual(stocke);
  });

  it("fait l'aller-retour d'une analyse sans la déformer", () => {
    const aller = serializeLayout(normalizeLayout([ANALYSE]));
    expect(aller).toEqual([ANALYSE]);
    expect(serializeLayout(normalizeLayout(aller))).toEqual([ANALYSE]);
  });

  it("construit une carte depuis un plan, sans app ni fenêtre", () => {
    const plan = parseExplorerPlan(
      { dataset: "views", measure: { aggregation: "count", field: "rows" }, visualization: "timeseries" },
      null,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const carte = widgetFromPlan(plan.value, { title: "Vues" });
    const [json] = serializeLayout([carte]) as Array<Record<string, unknown>>;
    expect(json.schemaVersion).toBe(2);
    expect(Object.keys(json.query as object)).not.toContain("app");
    expect(Object.keys(json.query as object)).not.toContain("range");
    expect(json.rangeOverride).toBeUndefined();
  });
});
