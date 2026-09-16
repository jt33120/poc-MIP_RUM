// Chantier A — séparation des métriques d'alerte vs SLO et libellés lisibles.
// Garde-fou : log_errors (métrique absolue) est une règle d'alerte mais PAS une
// cible de SLO (le modèle SLO « % conforme » ne s'y applique pas). La métrique
// ai_cost a été retirée avec la sortie de la supervision IA vers xSOM.
import { describe, expect, it } from "vitest";
import { ALERT_METRICS, isAlertMetric, METRIC_LABELS, metricLabel, SLO_METRICS } from "../../apps/console/lib/queries-v2";

describe("séparation ALERT_METRICS / SLO_METRICS", () => {
  it("les métriques SLO d'origine restent inchangées (vitals + error_rate)", () => {
    expect([...SLO_METRICS]).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB", "error_rate"]);
  });

  it("log_errors est une règle d'alerte mais PAS une cible de SLO", () => {
    expect(ALERT_METRICS).toContain("log_errors");
    expect(SLO_METRICS as readonly string[]).not.toContain("log_errors");
  });

  it("ai_cost n'est plus une métrique d'alerte (supervision IA sortie vers xSOM)", () => {
    expect(ALERT_METRICS as readonly string[]).not.toContain("ai_cost");
    expect(METRIC_LABELS.ai_cost).toBeUndefined();
  });

  it("ALERT_METRICS ajoute les comptes log et événement sans les rendre éligibles aux SLO", () => {
    expect([...ALERT_METRICS]).toEqual([...SLO_METRICS, "log_errors", "event"]);
    expect(isAlertMetric("event:checkout")).toBe(true);
    expect(isAlertMetric("event")).toBe(false);
    expect(isAlertMetric("event:")).toBe(false);
    expect(isAlertMetric(`event:${"x".repeat(101)}`)).toBe(false);
  });
});

describe("metricLabel", () => {
  it("libellé lisible avec unité pour chaque métrique connue", () => {
    expect(metricLabel("log_errors")).toBe("Logs ERROR (nombre)");
    expect(metricLabel("error_rate")).toBe("Taux d'erreur JS");
    expect(metricLabel("LCP")).toBe("LCP (ms)");
    expect(metricLabel("event:checkout")).toBe("Événement « checkout » (nombre)");
  });

  it("repli sur la clé brute si métrique inconnue", () => {
    expect(metricLabel("inconnue")).toBe("inconnue");
  });

  it("toutes les métriques d'alerte ont un libellé", () => {
    for (const m of ALERT_METRICS) expect(METRIC_LABELS[m]).toBeTruthy();
  });
});
