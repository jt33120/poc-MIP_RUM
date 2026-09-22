// Lois de probabilité de lib/stats/lois.ts contre des valeurs tabulées ou
// recalculées indépendamment (règle RM10 : pas de bibliothèque, donc des preuves).
import { describe, expect, it } from "vitest";
import {
  binomCdf,
  binomPmf,
  hypergeomQueue,
  lnFactorielle,
  normQuantile,
  tStudentQuantile,
} from "../../apps/console/lib/stats/lois";

describe("lnFactorielle", () => {
  it("exacte sur la table, continue au passage à Stirling", () => {
    expect(lnFactorielle(0)).toBe(0);
    expect(lnFactorielle(10)).toBeCloseTo(Math.log(3_628_800), 10);
    // 171 ! = 171 × 170 ! : Stirling doit prolonger la table sans saut.
    expect(lnFactorielle(171) - lnFactorielle(170)).toBeCloseTo(Math.log(171), 9);
    expect(() => lnFactorielle(-1)).toThrow();
  });
});

describe("binomiale", () => {
  it("binomCdf(12, 13, 0.75) = 1 − 0,75¹³", () => {
    expect(binomCdf(12, 13, 0.75)).toBeCloseTo(1 - 0.75 ** 13, 12);
    expect(binomCdf(12, 13, 0.75)).toBeCloseTo(0.976243, 6);
  });
  it("les probabilités somment à 1, et les bords sont exacts", () => {
    let s = 0;
    for (let k = 0; k <= 40; k++) s += binomPmf(k, 40, 0.3);
    expect(s).toBeCloseTo(1, 12);
    expect(binomCdf(-1, 10, 0.5)).toBe(0);
    expect(binomCdf(10, 10, 0.5)).toBe(1);
    expect(binomPmf(0, 5, 0)).toBe(1);
  });
});

describe("hypergeomQueue", () => {
  it("tirer 2 cartes marquées sur 2 dans 4 dont 2 marquées : 1/6", () => {
    expect(hypergeomQueue(2, 4, 2, 2)).toBeCloseTo(1 / 6, 12);
    expect(hypergeomQueue(0, 4, 2, 2)).toBe(1);
    expect(hypergeomQueue(3, 4, 2, 2)).toBe(0);
  });
});

describe("normQuantile", () => {
  it("valeurs de référence", () => {
    expect(normQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normQuantile(0.975)).toBeCloseTo(1.959964, 6);
    expect(normQuantile(0.8)).toBeCloseTo(0.841621, 6);
    expect(normQuantile(0.001)).toBeCloseTo(-3.090232, 5);
  });
});

// Fonction de répartition de Student par la fonction bêta incomplète régularisée
// (fraction continue de Lentz), écrite ICI, indépendamment du module, pour
// recontrôler chaque valeur de sa table.
function lnGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -t + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; c = 1 + aa / c; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
function betaReg(a: number, b: number, x: number): number {
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function tCdf(t: number, v: number): number {
  const x = v / (v + t * t);
  const queue = 0.5 * betaReg(v / 2, 0.5, x);
  return t >= 0 ? 1 - queue : queue;
}

describe("tStudentQuantile", () => {
  it("t(0,975 ; 10) = 2,228", () => {
    expect(tStudentQuantile(0.975, 10)).toBeCloseTo(2.228, 3);
    expect(tStudentQuantile(0.025, 10)).toBeCloseTo(-2.228, 3);
  });
  it("chaque valeur de la table retombe sur sa probabilité (intégration indépendante)", () => {
    for (const p of [0.95, 0.975, 0.995]) {
      for (let v = 1; v <= 30; v++) {
        // La table est à 3 décimales : l'erreur de probabilité reste sous 5 × 10⁻⁴.
        expect(Math.abs(tCdf(tStudentQuantile(p, v), v) - p), `p=${p}, ddl=${v}`).toBeLessThan(5e-4);
      }
    }
  });
  it("Cornish-Fisher au-delà de 30 ddl, à 10⁻³ près", () => {
    for (const v of [31, 40, 60, 120, 500]) {
      expect(Math.abs(tCdf(tStudentQuantile(0.975, v), v) - 0.975), `ddl=${v}`).toBeLessThan(1e-4);
    }
  });
});
