// P1 — détecteurs de frustration (logique pure, sans DOM) : rage clicks & dead clicks.
import { describe, expect, it } from "vitest";
import { isActionable, isDeadClick, RageDetector } from "../../packages/rum-sdk/src/frustration";

describe("RageDetector", () => {
  it("émet au 3e clic dans la fenêtre (rafale), une seule fois", () => {
    const d = new RageDetector(3, 1000);
    expect(d.click("btn", 0)).toBeNull();
    expect(d.click("btn", 200)).toBeNull();
    expect(d.click("btn", 400)).toBe(3); // seuil franchi
    expect(d.click("btn", 600)).toBeNull(); // déjà émis pour cette rafale
  });

  it("ne compte pas les clics hors fenêtre", () => {
    const d = new RageDetector(3, 1000);
    expect(d.click("btn", 0)).toBeNull();
    expect(d.click("btn", 1200)).toBeNull(); // > fenêtre depuis le 1er : réarme
    expect(d.click("btn", 1300)).toBeNull(); // 2 dans la fenêtre courante
    expect(d.click("btn", 1400)).toBe(3);
  });

  it("réarme sur changement de cible", () => {
    const d = new RageDetector(3, 1000);
    d.click("a", 0);
    d.click("a", 100);
    expect(d.click("b", 200)).toBeNull(); // cible différente -> repart de 1
    expect(d.click("b", 300)).toBeNull();
    expect(d.click("b", 400)).toBe(3);
  });

  it("une nouvelle rafale après coupure ré-émet", () => {
    const d = new RageDetector(3, 1000);
    d.click("btn", 0);
    d.click("btn", 100);
    expect(d.click("btn", 200)).toBe(3);
    // coupure > fenêtre puis nouvelle rafale
    expect(d.click("btn", 2000)).toBeNull();
    expect(d.click("btn", 2100)).toBeNull();
    expect(d.click("btn", 2200)).toBe(3);
  });
});

describe("isDeadClick", () => {
  it("mort si aucune réaction après le clic", () => {
    expect(isDeadClick(1000, { mutation: 500, nav: 0, scroll: 200 })).toBe(true);
  });
  it("vivant si une mutation DOM suit le clic", () => {
    expect(isDeadClick(1000, { mutation: 1200, nav: 0, scroll: 0 })).toBe(false);
  });
  it("vivant si une navigation suit le clic", () => {
    expect(isDeadClick(1000, { mutation: 0, nav: 1100, scroll: 0 })).toBe(false);
  });
  it("vivant si un scroll suit le clic", () => {
    expect(isDeadClick(1000, { mutation: 0, nav: 0, scroll: 1050 })).toBe(false);
  });
  it("une réaction exactement au temps du clic ne compte pas (≤)", () => {
    expect(isDeadClick(1000, { mutation: 1000, nav: 1000, scroll: 1000 })).toBe(true);
  });
});

describe("isActionable", () => {
  it("vrai sans inspection si l'élément est interactif", () => {
    expect(isActionable({} as Element, true)).toBe(true);
  });
});
