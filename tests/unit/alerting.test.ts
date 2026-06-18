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
