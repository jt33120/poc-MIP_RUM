// Graduations d'axe (recette du 26/09/2026) : des pas ronds, un axe qui part de 0,
// une seule unité et une seule précision par axe.
import { describe, expect, it } from "vitest";
import { decimalesCommunes, etiquettesGraduations, graduationsAxe, graduationsY } from "@/lib/graduations";

/** Espaces insécables rendus lisibles. */
const txt = (l: string[]) => l.map((s) => s.replace(/[  ]/g, " "));

/** Le pas est régulier : toutes les différences successives sont égales. */
function pasRegulier(valeurs: number[]): boolean {
  const pas = valeurs[1] - valeurs[0];
  return valeurs.every((v, i) => i === 0 || Math.abs(v - valeurs[i - 1] - pas) < 1e-9);
}

describe("graduationsY", () => {
  it("les exemples de la recette : 278 → 0-100-200-300, 1 312 → 0-500-1 000-1 500", () => {
    expect(graduationsY(278)).toEqual({ haut: 300, valeurs: [0, 100, 200, 300] });
    expect(graduationsY(1312)).toEqual({ haut: 1500, valeurs: [0, 500, 1000, 1500] });
    expect(graduationsY(186).haut).toBe(200);
  });

  it("une part de 41,6 % s'arrête à 50 %, par pas de 10 %", () => {
    expect(graduationsY(0.416)).toEqual({ haut: 0.5, valeurs: [0, 0.1, 0.2, 0.3, 0.4, 0.5] });
  });

  it("un compte part de 0 et se gradue en unités entières (« axe de 1 à 3, sans 0 »)", () => {
    expect(graduationsY(3, { entier: true })).toEqual({ haut: 3, valeurs: [0, 1, 2, 3] });
    expect(graduationsY(1, { entier: true })).toEqual({ haut: 1, valeurs: [0, 1] });
    expect(graduationsY(11, { entier: true })).toEqual({ haut: 15, valeurs: [0, 5, 10, 15] });
    for (const v of graduationsY(7, { entier: true }).valeurs) expect(Number.isInteger(v)).toBe(true);
  });

  it("toujours de 0 au-dessus du maximum, au pas régulier, en 1 à 5 intervalles", () => {
    for (const max of [0.0042, 0.275, 3.9, 9.3, 92, 809, 2750, 4680, 12_345, 987_654]) {
      const g = graduationsY(max);
      expect(g.valeurs[0]).toBe(0);
      expect(g.haut).toBeGreaterThanOrEqual(max);
      expect(g.valeurs.at(-1)).toBe(g.haut);
      expect(pasRegulier(g.valeurs)).toBe(true);
      expect(g.valeurs.length - 1).toBeGreaterThanOrEqual(1);
      expect(g.valeurs.length - 1).toBeLessThanOrEqual(5);
      // Le pas est « rond » : 1, 2, 2,5 ou 5 × 10ⁿ.
      const pas = g.valeurs[1];
      const mantisse = Number((pas / 10 ** Math.floor(Math.log10(pas))).toPrecision(6));
      expect([1, 2, 2.5, 5]).toContain(mantisse);
    }
  });

  it("à haut égal, le pas sans décimale de plus : 9,3 ms → 0-2-4-6-8-10", () => {
    expect(graduationsY(9.3).valeurs).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("aucune valeur (ou non finie) : un axe [0 ; 1]", () => {
    expect(graduationsY(0).haut).toBe(1);
    expect(graduationsY(Number.NaN).valeurs).toEqual([0, 0.5, 1]);
    expect(graduationsY(-4, { entier: true }).valeurs).toEqual([0, 1]);
  });

  it("une durée longue tombe sur des minutes rondes", () => {
    const g = graduationsAxe(372_000, "s-auto");
    expect(g.valeurs.every((v) => v % 60_000 === 0)).toBe(true);
    expect(txt(etiquettesGraduations(g.valeurs, "s-auto"))).toEqual(["0 min", "2 min", "4 min", "6 min", "8 min"]);
  });
});

describe("etiquettesGraduations : une seule unité, une seule précision", () => {
  it("durée : en secondes pour tout l'axe dès 1 s (plus « 2,8 s / 1,4 s / 700 ms / 0 ms »)", () => {
    expect(txt(etiquettesGraduations([0, 1000, 2000, 3000], "ms"))).toEqual(["0 s", "1 s", "2 s", "3 s"]);
    expect(txt(etiquettesGraduations([0, 500, 1000, 1500], "ms"))).toEqual(["0,0 s", "0,5 s", "1,0 s", "1,5 s"]);
    expect(txt(etiquettesGraduations([0, 100, 200, 300, 400], "ms"))).toEqual(["0 ms", "100 ms", "200 ms", "300 ms", "400 ms"]);
  });

  it("part : « 0 % … 50 % », espace insécable avant « % »", () => {
    const l = etiquettesGraduations([0, 0.1, 0.2, 0.3, 0.4, 0.5], "pct");
    expect(l[5]).toBe("50 %");
    expect(txt(l)).toEqual(["0 %", "10 %", "20 %", "30 %", "40 %", "50 %"]);
  });

  it("CLS : virgule française, mêmes décimales (plus « 0,000,100 »)", () => {
    expect(etiquettesGraduations([0, 0.1, 0.2, 0.3], "cls")).toEqual(["0,0", "0,1", "0,2", "0,3"]);
    expect(etiquettesGraduations([0, 0.05, 0.1, 0.15], "cls")).toEqual(["0,00", "0,05", "0,10", "0,15"]);
  });

  it("compte : en milliers pour tout l'axe dès 10 000", () => {
    expect(txt(etiquettesGraduations([0, 5000, 10_000, 15_000], "count"))).toEqual(["0 k", "5 k", "10 k", "15 k"]);
    expect(txt(etiquettesGraduations([0, 500, 1000, 1500], "count"))).toEqual(["0", "500", "1 000", "1 500"]);
  });

  it("decimalesCommunes : le moins de décimales qui écrit chaque valeur exactement", () => {
    expect(decimalesCommunes([0, 1, 2], 3)).toBe(0);
    expect(decimalesCommunes([0, 0.5, 1], 3)).toBe(1);
    expect(decimalesCommunes([0, 0.25], 3)).toBe(2);
    expect(decimalesCommunes([1 / 3], 2)).toBe(2);
  });
});
