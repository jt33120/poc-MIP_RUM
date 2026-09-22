// Le tableau de cadrage du plan (§ 7.0, « Le volume qui décide de tout »), recalculé.
//
// Ce tableau fonde l'épique P* : à 30 sessions par jour, ce qu'on peut dire et
// ce qu'on ne peut pas. S'il était recopié à la main dans un texte, rien ne dirait
// qu'il est faux le jour où une formule change. Ici, chaque cellule est
// RECALCULÉE depuis lib/stats/incertitude.ts et comparée au texte du plan, à
// 0,1 point près.
import { describe, expect, it } from "vitest";
import { ecartDetectable, mesuresMinimales, regleDeTrois, wilson } from "../../apps/console/lib/stats/incertitude";

// Cellules du § 7.0, en points de pourcentage, telles que le plan les écrit.
const PLAN = {
  wilson10pct: { 30: [3.5, 25.6], 210: [6.6, 14.8], 900: [8.2, 12.1] },
  zeroErreur: { 30: 10, 210: 1.4, 900: 0.33 },
  ecart: { "100/100": 11.9, "450/450": 5.6 },
  minimumP75: 13,
} as const;
const pts = (v: number) => v * 100;

describe("cadrage § 7.0", () => {
  it("part de sessions en erreur observée à 10 % : intervalle de Wilson à 95 %", () => {
    for (const [n, [bas, haut]] of Object.entries(PLAN.wilson10pct)) {
      const w = wilson(Number(n) / 10, Number(n));
      expect(w.ok).toBe(true);
      if (!w.ok) continue;
      expect(Math.abs(pts(w.bas) - bas), `bas, n=${n}`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(pts(w.haut) - haut), `haut, n=${n}`).toBeLessThanOrEqual(0.1);
    }
  });

  it("zéro erreur observée : part maximale compatible (règle de trois)", () => {
    for (const [n, attendu] of Object.entries(PLAN.zeroErreur)) {
      const r = regleDeTrois(Number(n));
      expect(r.ok && Math.abs(pts(r.haut) - attendu) <= 0.1, `n=${n}`).toBe(true);
    }
  });

  it("deux releases à 10 % d'erreur : plus petit écart détectable (puissance 80 %)", () => {
    expect(Math.abs(pts(ecartDetectable(0.1, 100, 100)) - PLAN.ecart["100/100"])).toBeLessThanOrEqual(0.1);
    expect(Math.abs(pts(ecartDetectable(0.1, 450, 450)) - PLAN.ecart["450/450"])).toBeLessThanOrEqual(0.1);
  });

  it("p75 : 13 mesures au minimum pour un intervalle bilatéral à 95 %", () => {
    expect(mesuresMinimales()).toBe(PLAN.minimumP75);
  });
});
