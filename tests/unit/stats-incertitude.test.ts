// Incertitude des chiffres clés (P*.1) : les rangs, Wilson, Newcombe, la règle
// de trois et l'écart détectable, vérifiés par la binomiale EXACTE.
import { describe, expect, it } from "vitest";
import { binomCdf } from "../../apps/console/lib/stats/lois";
import {
  couvertureRangs,
  ecartDetectable,
  ecartP75,
  ecartProportions,
  intervalleWilson,
  intervalleQuantile,
  mesuresMinimales,
  newcombe,
  rangsQuantileExact,
  rangsQuantileNormal,
  regleDeTrois,
  wilson,
} from "../../apps/console/lib/stats/incertitude";

// Table du plan (§ 7.2, P*.1), recalculée par binomiale exacte à sa rédaction.
const TABLE: Record<number, [number, number, number]> = {
  13: [7, 13, 0.952], 14: [7, 14, 0.972], 15: [8, 15, 0.969], 16: [8, 16, 0.983], 17: [9, 17, 0.98],
  18: [10, 18, 0.975], 19: [10, 19, 0.987], 20: [11, 19, 0.962], 21: [12, 20, 0.96], 22: [12, 21, 0.975],
  23: [13, 22, 0.974], 24: [14, 23, 0.97], 25: [14, 24, 0.982], 26: [15, 25, 0.979], 27: [16, 25, 0.958],
  28: [16, 26, 0.972], 29: [17, 27, 0.971],
};

describe("rangsQuantileExact — table exhaustive n = 13…29", () => {
  for (const [n, [r, s, couverture]] of Object.entries(TABLE).map(([k, v]) => [Number(k), v] as const)) {
    it(`n = ${n} → (${r}, ${s}), chaque queue ≤ 2,5 %, couverture ≥ 95 %`, () => {
      const res = rangsQuantileExact(n);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect([res.r, res.s]).toEqual([r, s]);
      expect(binomCdf(r - 1, n, 0.75)).toBeLessThanOrEqual(0.025); // sous x(r)
      expect(1 - binomCdf(s - 1, n, 0.75)).toBeLessThanOrEqual(0.025); // au-dessus de x(s)
      expect(res.couverture).toBeGreaterThanOrEqual(0.95);
      expect(Math.abs(res.couverture - couverture)).toBeLessThan(0.0015); // table à 3 décimales
    });
  }

  it("n = 12 : refus chiffré, jamais un intervalle", () => {
    expect(rangsQuantileExact(12)).toEqual({
      ok: false,
      raison: "12 mesures, 13 requises",
      manque: { requis: 13, observe: 12, unite: "mesures" },
    });
    expect(mesuresMinimales()).toBe(13);
  });
});

describe("rangsQuantileNormal", () => {
  it("n = 30 : (17, 29), comme écrit dans le plan", () => {
    expect(rangsQuantileNormal(30)).toEqual({ r: 17, s: 29 });
  });

  it("couverture ≥ 95 % pour tout n de 30 à 5 000 (binomiale exacte)", () => {
    let pire = { n: 0, c: 1 };
    for (let n = 30; n <= 5000; n++) {
      const { r, s } = rangsQuantileNormal(n);
      const c = couvertureRangs(n, r, s);
      if (c < pire.c) pire = { n, c };
    }
    expect(pire.c, `pire cas à n = ${pire.n}`).toBeGreaterThanOrEqual(0.95);
  }, 60_000);
});

describe("intervalleQuantile", () => {
  const triees = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 100);
  it("bornes = mesures aux rangs, méthode nommée", () => {
    expect(intervalleQuantile(triees(13))).toMatchObject({ ok: true, bas: 700, haut: 1300, methode: "quantile_exact" });
    expect(intervalleQuantile(triees(20))).toMatchObject({ ok: true, bas: 1100, haut: 1900, methode: "quantile_exact" });
    expect(intervalleQuantile(triees(30))).toMatchObject({ ok: true, bas: 1700, haut: 2900, methode: "quantile_normal" });
  });
  it("sous 13 mesures : refus", () => {
    expect(intervalleQuantile(triees(7))).toMatchObject({ ok: false, raison: "7 mesures, 13 requises" });
  });
});

describe("proportions", () => {
  it("wilson(3, 30) = [0,035 ; 0,256]", () => {
    const w = wilson(3, 30);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.bas).toBeCloseTo(0.035, 3);
    expect(w.haut).toBeCloseTo(0.256, 3);
  });
  it("wilson(0, 0) : refus, pas « 0 % »", () => {
    expect(wilson(0, 0).ok).toBe(false);
  });
  it("wilson reste dans [0 ; 1] aux bords", () => {
    const zero = wilson(0, 20);
    const tout = wilson(20, 20);
    expect(zero.ok && zero.bas).toBe(0);
    expect(tout.ok && tout.haut).toBe(1);
  });
  it("newcombe : un écart dont l'intervalle contient 0 n'est pas établi", () => {
    const proche = newcombe(10, 100, 12, 100);
    expect(proche.ok && proche.bas < 0 && proche.haut > 0).toBe(true);
    const loin = newcombe(40, 100, 10, 100);
    expect(loin.ok && loin.bas > 0).toBe(true);
  });
  it("règle de trois et écart détectable", () => {
    expect(regleDeTrois(30)).toEqual({ ok: true, haut: 0.1 });
    expect(regleDeTrois(0).ok).toBe(false);
    expect(ecartDetectable(0.1, 100, 100)).toBeCloseTo(0.119, 3);
    expect(ecartDetectable(0.1, 450, 450)).toBeCloseTo(0.056, 3);
  });
});

describe("RM5 — association n'est pas cause", () => {
  it("aucun texte produit ne parle de cause ni de responsable", () => {
    const textes = [rangsQuantileExact(5), wilson(0, 0), regleDeTrois(0), intervalleQuantile([1, 2])]
      .flatMap((r) => (r.ok ? [] : [r.raison]));
    for (const t of textes) expect(t).not.toMatch(/cause|responsable/i);
  });
});

// P*.1 — ce que les tuiles reçoivent : l'intervalle d'une proportion, et le droit
// de dire qu'un écart à la période précédente est établi.
describe("intervalleWilson — la forme `KpiTile.intervalle`", () => {
  it("wilson(3, 30) = [0,035 ; 0,256], méthode nommée", () => {
    const i = intervalleWilson(3, 30);
    expect(i && !("indisponible" in i) && i.methode).toBe("wilson");
    if (!i || "indisponible" in i) return;
    expect(i.bas).toBeCloseTo(0.035, 3);
    expect(i.haut).toBeCloseTo(0.256, 3);
  });
  it("sans dénominateur : null (la valeur est null avec sa raison), jamais un intervalle", () => {
    expect(intervalleWilson(0, 0)).toBeNull();
    expect(intervalleWilson(0, null)).toBeNull();
    expect(intervalleWilson(null, 30)).toBeNull();
  });
  it("numérateur hors de [0 ; n] : dit, ni jeté ni rogné", () => {
    expect(intervalleWilson(31, 30)).toEqual({ indisponible: "numérateur (31) hors de [0 ; 30] : ce n'est pas une proportion" });
  });
});

describe("ecartProportions — Newcombe : zéro compris → écart non établi", () => {
  it("10 % contre 12 % sur 100/100 : non établi, bornes écrites", () => {
    const e = ecartProportions(10, 100, 12, 100);
    expect(e?.etabli).toBe(false);
    expect(e?.regle).toMatch(/^écart non établi : la différence est de -\d+(,\d)? à \+\d+(,\d)? points \(Newcombe, 95 %\), zéro compris$/);
  });
  it("40 % contre 10 % : établi", () => {
    expect(ecartProportions(40, 100, 10, 100)?.etabli).toBe(true);
  });
  it("un côté sans dénominateur : rien à comparer", () => {
    expect(ecartProportions(1, 10, 0, 0)).toBeNull();
    expect(ecartProportions(11, 10, 1, 10)).toBeNull();
  });
});

describe("ecartP75 — pas de test, deux intervalles comparés", () => {
  const iv = (bas: number, haut: number) => ({ bas, haut, niveau: 0.95 as const, methode: "quantile_exact" as const });
  it("chevauchement → non établi, l'intervalle précédent écrit", () => {
    const e = ecartP75(iv(2100, 3000), iv(1900, 2200), (v) => `${v} ms`);
    expect(e).toEqual({
      etabli: false,
      regle: "écart non établi : intervalles à 95 % qui se chevauchent (période précédente entre 1900 ms et 2200 ms)",
    });
  });
  it("disjoints → établi", () => {
    expect(ecartP75(iv(2600, 3000), iv(1900, 2200))?.etabli).toBe(true);
  });
  it("un intervalle non calculable d'un côté → non établi", () => {
    expect(ecartP75(iv(2600, 3000), { indisponible: "7 mesures, 13 requises" })?.etabli).toBe(false);
  });
  it("aucun intervalle fourni → rien à dire", () => {
    expect(ecartP75(undefined, iv(1, 2))).toBeNull();
  });
  it("RM5 : aucun texte ne parle de cause", () => {
    const textes = [
      ecartP75(iv(2100, 3000), iv(1900, 2200))?.regle,
      ecartProportions(10, 100, 12, 100)?.regle,
      ecartProportions(40, 100, 10, 100)?.regle,
    ];
    for (const t of textes) expect(t).not.toMatch(/cause|responsable/i);
  });
});
