// P0 #5 — vue quota (lib/usage.ts), helper pur.
import { describe, expect, it } from "vitest";
import { quotaView } from "../../apps/console/lib/usage";

describe("quotaView", () => {
  it("quota null → illimité, jamais en dépassement", () => {
    expect(quotaView(10_000, null)).toEqual({ pct: null, over: false, label: "illimité" });
  });
  it("quota ≤ 0 → illimité", () => {
    expect(quotaView(5, 0)).toMatchObject({ pct: null, over: false });
  });
  it("sous le quota → pct + over=false", () => {
    expect(quotaView(620, 1000)).toEqual({ pct: 62, over: false, label: "62%" });
  });
  it("au-dessus du quota → over=true, pct > 100", () => {
    const v = quotaView(1500, 1000);
    expect(v.over).toBe(true);
    expect(v.pct).toBe(150);
  });
  it("pile au quota → pas de dépassement", () => {
    expect(quotaView(1000, 1000).over).toBe(false);
  });
});
