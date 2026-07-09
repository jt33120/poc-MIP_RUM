// Objectifs — matching + taux de conversion. Logique pure.
import { describe, expect, it } from "vitest";
import { conversionRate, goalMatches } from "../../apps/console/lib/goals";

describe("goalMatches", () => {
  it("exact = égalité stricte", () => {
    expect(goalMatches("exact", "/merci", "/merci")).toBe(true);
    expect(goalMatches("exact", "/merci", "/merci/2")).toBe(false);
  });
  it("contains = sous-chaîne", () => {
    expect(goalMatches("contains", "checkout", "/app/checkout/step2")).toBe(true);
    expect(goalMatches("contains", "checkout", "/panier")).toBe(false);
  });
});

describe("conversionRate", () => {
  it("ratio borné, 0 si aucune session", () => {
    expect(conversionRate(3, 12)).toBeCloseTo(0.25);
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(5, 0)).toBe(0);
  });
});
