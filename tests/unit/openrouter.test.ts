// Solde OpenRouter — parsing crédits, statut, franchissement. Logique pure.
import { describe, expect, it } from "vitest";
import { balanceStatus, crossedIntoLow, parseCredits } from "../../apps/console/lib/openrouter";

describe("parseCredits", () => {
  it("forme /credits : balance = total_credits - total_usage", () => {
    expect(parseCredits({ data: { total_credits: 20, total_usage: 12.5 } })).toEqual({
      total_credits: 20,
      total_usage: 12.5,
      balance: 7.5,
    });
  });
  it("forme /auth/key : utilise limit_remaining comme solde", () => {
    const r = parseCredits({ data: { limit: 30, usage: 26, limit_remaining: 4 } });
    expect(r?.balance).toBe(4);
    expect(r?.total_usage).toBe(26);
  });
  it("null si réponse illisible", () => {
    expect(parseCredits(null)).toBeNull();
    expect(parseCredits({})).toBeNull();
    expect(parseCredits({ data: {} })).toBeNull();
    expect(parseCredits({ data: { total_credits: "x" } })).toBeNull();
  });
});

describe("balanceStatus", () => {
  it("« low » strictement sous le seuil", () => {
    expect(balanceStatus(4.99, 5)).toBe("low");
    expect(balanceStatus(5, 5)).toBe("ok");
    expect(balanceStatus(12, 5)).toBe("ok");
  });
});

describe("crossedIntoLow", () => {
  it("alerte seulement au franchissement ok/none -> low", () => {
    expect(crossedIntoLow("ok", "low")).toBe(true);
    expect(crossedIntoLow(null, "low")).toBe(true);
    expect(crossedIntoLow("low", "low")).toBe(false); // déjà bas : géré par cooldown
    expect(crossedIntoLow("ok", "ok")).toBe(false);
    expect(crossedIntoLow("low", "ok")).toBe(false); // remontée
  });
});
