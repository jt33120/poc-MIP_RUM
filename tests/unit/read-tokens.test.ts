// Tokens de lecture — hash déterministe, génération, fenêtre. Logique pure.
import { describe, expect, it } from "vitest";
import { generateToken, hashToken, parseWindow } from "../../apps/console/lib/read-tokens";

describe("hashToken", () => {
  it("sha256 hex déterministe (vecteur connu)", () => {
    // sha256("abc") connu
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashToken("x")).toHaveLength(64);
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("generateToken", () => {
  it("préfixé mrk_ et non trivial ; deux appels diffèrent", () => {
    const a = generateToken();
    expect(a.startsWith("mrk_")).toBe(true);
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(generateToken());
  });
});

describe("parseWindow", () => {
  it("mappe 24h/7d/30d ; défaut 30d ; tolère 7j", () => {
    expect(parseWindow("24h")).toEqual({ key: "24h", interval: "24 hours" });
    expect(parseWindow("7d")).toEqual({ key: "7d", interval: "7 days" });
    expect(parseWindow("7j").key).toBe("7d");
    expect(parseWindow("30d")).toEqual({ key: "30d", interval: "30 days" });
    expect(parseWindow(null).key).toBe("30d");
    expect(parseWindow("bidon").key).toBe("30d");
  });
});
