// Satisfaction déclarée (Lot A DEM) — logique pure : CSAT, moyenne, répartition.
import { describe, expect, it } from "vitest";
import { avgScore, breakdown, csatRatio } from "../../apps/console/lib/experience";

describe("csatRatio", () => {
  it("part des notes >= 4", () => {
    expect(csatRatio([5, 4, 3, 1])).toBeCloseTo(0.5, 6);
  });
  it("aucun feedback -> null", () => {
    expect(csatRatio([])).toBeNull();
  });
});

describe("avgScore / breakdown", () => {
  it("moyenne", () => {
    expect(avgScore([2, 4])).toBe(3);
    expect(avgScore([])).toBeNull();
  });
  it("promoteurs/passifs/détracteurs", () => {
    expect(breakdown([5, 5, 4, 3, 2, 1])).toEqual({ promoters: 2, passives: 2, detractors: 2 });
  });
});
