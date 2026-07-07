// Score d'expérience (Lot A DEM) — logique pure : CSAT, blend, pénalités, paliers.
import { describe, expect, it } from "vitest";
import {
  avgScore,
  breakdown,
  csatRatio,
  experienceScore,
  frustrationPenalty,
  scoreTone,
} from "../../apps/console/lib/experience";

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

describe("experienceScore", () => {
  it("sans feedback : perf ajustée de la frustration", () => {
    expect(experienceScore({ vitals: 90, frustrationPenalty: 10 })).toBe(80);
  });
  it("avec feedback : 60% mesuré / 40% déclaré", () => {
    // base = 80 ; csat 0.5 -> 0.6*80 + 0.4*50 = 48 + 20 = 68
    expect(experienceScore({ vitals: 80, csat: 0.5 })).toBe(68);
  });
  it("borne le score dans [0,100]", () => {
    expect(experienceScore({ vitals: 10, frustrationPenalty: 50 })).toBe(0);
    expect(experienceScore({ vitals: 100, csat: 1 })).toBe(100);
  });
});

describe("frustrationPenalty", () => {
  it("croît avec le taux, plafonnée", () => {
    expect(frustrationPenalty(0)).toBe(0);
    expect(frustrationPenalty(5)).toBe(10);
    expect(frustrationPenalty(1000)).toBe(20); // plafond
  });
});

describe("scoreTone", () => {
  it("paliers good/warn/bad", () => {
    expect(scoreTone(85)).toBe("good");
    expect(scoreTone(70)).toBe("warn");
    expect(scoreTone(40)).toBe("bad");
  });
});
