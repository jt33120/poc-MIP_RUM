// Coût IA par dimension — validation de ?group_by (allowlist). Logique pure.
import { describe, expect, it } from "vitest";
import { AI_COST_DIMENSIONS, parseCostDimension } from "../../apps/console/lib/ai-costs";

describe("parseCostDimension", () => {
  it("accepte les dimensions de l'allowlist", () => {
    for (const d of AI_COST_DIMENSIONS) expect(parseCostDimension(d)).toBe(d);
  });
  it("normalise casse et espaces", () => {
    expect(parseCostDimension(" USER ")).toBe("user");
    expect(parseCostDimension("Model")).toBe("model");
  });
  it("replie sur \"user\" par défaut (absent, vide, inconnu, injection)", () => {
    expect(parseCostDimension(null)).toBe("user");
    expect(parseCostDimension(undefined)).toBe("user");
    expect(parseCostDimension("")).toBe("user");
    expect(parseCostDimension("app_id")).toBe("user");
    expect(parseCostDimension("user; drop table rum_ai")).toBe("user");
  });
});
