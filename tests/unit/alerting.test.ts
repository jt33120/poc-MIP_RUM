// P1 — helpers purs de l'alerting mature (lib/alerting.ts).
import { describe, expect, it } from "vitest";
import { severityRank, sloView } from "../../apps/console/lib/alerting";

describe("severityRank", () => {
  it("ordonne info<warning<critical", () => {
    expect(severityRank("info")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("critical"));
  });
  it("inconnu = 0", () => expect(severityRank("???")).toBe(0));
});

describe("sloView (error-budget)", () => {
  it("budget = 1 - objectif", () => {
    expect(sloView(1, 0.99).budget).toBeCloseTo(0.01, 6);
  });
  it("objectif atteint, budget peu consommé → ok", () => {
    const v = sloView(0.999, 0.99); // 0.1% manquant sur 1% de budget = 10%
    expect(v.status).toBe("ok");
    expect(v.burnedPct).toBeCloseTo(10, 4);
  });
  it("≥75% du budget consommé → at_risk", () => {
    const v = sloView(0.992, 0.99); // 0.8% manquant / 1% budget = 80%
    expect(v.status).toBe("at_risk");
  });
  it("objectif manqué → breached (>100%)", () => {
    const v = sloView(0.95, 0.99); // 5% manquant / 1% budget = 500%
    expect(v.status).toBe("breached");
    expect(v.burnedPct).toBeGreaterThan(100);
  });
  it("burnedPct plafonné à 999", () => {
    expect(sloView(0, 0.99).burnedPct).toBe(999);
  });
  it("objectif 100% : tout manquement = breach", () => {
    expect(sloView(1, 1).status).toBe("ok");
    expect(sloView(0.999, 1).status).toBe("breached");
  });
});

// B52 / F68 — les nombres de la règle de release ne sont pas réinventés : chacun
// est lié à la règle de la console qu'il reprend, ET à sa copie SQL (migration-v86).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as alerting from "../../apps/console/lib/alerting";
import { FAIBLE_SOUS_DEFAUT } from "../../apps/console/components/charts/KpiTile";
import { assessRegression } from "../../apps/console/lib/queries-deploys";
import { VITAUX } from "../../apps/console/lib/fmt-ids";

describe("règle de release : constantes liées à la console et au SQL", () => {
  const v86 = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v86.sql"), "utf8");

  it("100 mesures par release : le seuil sous lequel une tuile refuse déjà un écart de p75", () => {
    expect(alerting.MESURES_MIN_RELEASE).toBe(FAIBLE_SOUS_DEFAUT);
    expect(v86).toContain(`n_b < ${alerting.MESURES_MIN_RELEASE} or n_a < ${alerting.MESURES_MIN_RELEASE}`);
    expect(v86).toContain(`${alerting.MESURES_MIN_RELEASE} requises par release`);
  });

  it("+20 % par défaut : la borne exacte de assessRegression (≥, ratio 1,2)", () => {
    const pct = alerting.SEUIL_REGRESSION_DEFAUT;
    expect(assessRegression(2000, 2000 * (1 + pct / 100)).regressed).toBe(true);
    expect(assessRegression(2000, 2000 * (1 + pct / 100) - 1).regressed).toBe(false);
    // Même comparaison en SQL : « ≥ précédente × (1 + seuil / 100) ».
    expect(v86).toContain("p75_b::numeric >= p75_a::numeric * (1 + r.threshold::numeric / 100)");
  });

  it("les métriques d'une règle de release sont les cinq Web Vitals, partout", () => {
    expect([...alerting.RELEASE_METRICS]).toEqual([...VITAUX]);
    const liste = `(${VITAUX.map((v) => `'${v}'`).join(", ")})`;
    // Contrainte de table ET garde de check_alerts.
    expect(v86.split(`metric in ${liste}`).length - 1).toBe(1);
    expect(v86.split(`r.metric not in ${liste}`).length - 1).toBe(1);
  });

  it("le mode est connu de la console et nommé", () => {
    expect(alerting.ALERT_MODES).toContain("release");
    expect(alerting.ruleModeLabel("release")).toBe("régression de release");
    expect(alerting.ruleModeLabel("baseline")).toBe("anomalie (baseline)");
    expect(alerting.ruleModeLabel("threshold")).toBe("seuil");
  });
});
