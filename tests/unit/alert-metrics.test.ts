// Chantier A — séparation des métriques d'alerte vs SLO et libellés lisibles.
// Garde-fou : ai_cost / log_errors (métriques absolues) sont des règles d'alerte
// mais PAS des cibles de SLO (le modèle SLO « % conforme » ne s'y applique pas).
import { describe, expect, it } from "vitest";
import { ALERT_METRICS, METRIC_LABELS, metricLabel, SLO_METRICS } from "../../apps/console/lib/queries-v2";

describe("séparation ALERT_METRICS / SLO_METRICS", () => {
  it("les métriques SLO d'origine restent inchangées (vitals + error_rate)", () => {
    expect([...SLO_METRICS]).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB", "error_rate"]);
  });

  it("ai_cost et log_errors sont des règles d'alerte mais PAS des cibles de SLO", () => {
    expect(ALERT_METRICS).toContain("ai_cost");
    expect(ALERT_METRICS).toContain("log_errors");
    expect(SLO_METRICS as readonly string[]).not.toContain("ai_cost");
    expect(SLO_METRICS as readonly string[]).not.toContain("log_errors");
  });

  it("ALERT_METRICS = SLO_METRICS ∪ {ai_cost, log_errors}", () => {
    expect([...ALERT_METRICS]).toEqual([...SLO_METRICS, "ai_cost", "log_errors"]);
  });
});

describe("metricLabel", () => {
  it("libellé lisible avec unité pour chaque métrique connue", () => {
    expect(metricLabel("ai_cost")).toBe("Coût IA cumulé ($)");
    expect(metricLabel("log_errors")).toBe("Logs ERROR (nombre)");
    expect(metricLabel("error_rate")).toBe("Taux d'erreur JS");
    expect(metricLabel("LCP")).toBe("LCP (ms)");
  });

  it("repli sur la clé brute si métrique inconnue", () => {
    expect(metricLabel("inconnue")).toBe("inconnue");
  });

  it("toutes les métriques d'alerte ont un libellé", () => {
    for (const m of ALERT_METRICS) expect(METRIC_LABELS[m]).toBeTruthy();
  });
});
