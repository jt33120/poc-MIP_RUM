// Lois de probabilité — logique PURE, sans dépendance (règle RM10 du plan, § 7.1).
//
// Pourquoi les écrire plutôt qu'importer une bibliothèque : il en faut quatre, sur
// des tableaux de quelques centaines de valeurs au plus, et chacune est testée
// contre des valeurs tabulées (tests/unit/stats-lois.test.ts). Une dépendance npm
// de statistiques pèserait plus que tout ce module, pour des fonctions dont on ne
// verrait pas l'implémentation.

// ln(n!) exact jusqu'à 170 (au-delà, n! dépasse le plus grand double), par somme
// de logarithmes ; Stirling avec ses termes correctifs au-delà.
const LN_FACT: number[] = (() => {
  const t = [0];
  for (let i = 1; i <= 170; i++) t[i] = t[i - 1] + Math.log(i);
  return t;
})();

export function lnFactorielle(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`lnFactorielle : entier positif attendu, reçu ${n}`);
  if (n <= 170) return LN_FACT[n];
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n) + 1 / (12 * n) - 1 / (360 * n ** 3) + 1 / (1260 * n ** 5);
}

export function lnCombinaison(n: number, k: number): number {
  return lnFactorielle(n) - lnFactorielle(k) - lnFactorielle(n - k);
}

/** P(B = k), B ~ Binomiale(n ; p). */
export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(lnCombinaison(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(B ≤ k), B ~ Binomiale(n ; p). */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let somme = 0;
  for (let i = 0; i <= k; i++) somme += binomPmf(i, n, p);
  return Math.min(1, somme);
}

/**
 * P(X ≥ k), X ~ Hypergéométrique : `tirages` éléments tirés sans remise dans une
 * population de `population` éléments dont `marques` sont marqués.
 */
export function hypergeomQueue(k: number, population: number, marques: number, tirages: number): number {
  const max = Math.min(marques, tirages);
  const min = Math.max(0, tirages - (population - marques));
  if (k <= min) return 1;
  if (k > max) return 0;
  const lnTotal = lnCombinaison(population, tirages);
  let somme = 0;
  for (let i = k; i <= max; i++) {
    somme += Math.exp(lnCombinaison(marques, i) + lnCombinaison(population - marques, tirages - i) - lnTotal);
  }
  return Math.min(1, somme);
}

/**
 * Quantile de la loi normale centrée réduite — algorithme d'Acklam (erreur
 * relative < 1,15 × 10⁻⁹ sur ]0 ; 1[).
 */
export function normQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normQuantile : p dans ]0 ; 1[, reçu ${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const bas = 0.02425;
  if (p < bas) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - bas) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Quantiles exacts de la loi de Student, ddl 1 à 30, pour les trois probabilités
// dont la console a besoin (tests unilatéral à 5 %, intervalle à 95 %, à 99 %).
// Chaque valeur est recontrôlée par intégration numérique dans le test.
const T_TABLE: Record<string, readonly number[]> = {
  "0.95": [6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.74, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697],
  "0.975": [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042],
  "0.995": [63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.25, 3.169, 3.106, 3.055, 3.012, 2.977, 2.947, 2.921, 2.898, 2.878, 2.861, 2.845, 2.831, 2.819, 2.807, 2.797, 2.787, 2.779, 2.771, 2.763, 2.756, 2.75],
};

/**
 * Quantile de la loi de Student à `ddl` degrés de liberté. Table exacte pour
 * ddl ≤ 30 et p ∈ {0,95 ; 0,975 ; 0,995} ; développement de Cornish-Fisher
 * au-delà (erreur < 10⁻³ dès ddl = 30).
 */
export function tStudentQuantile(p: number, ddl: number): number {
  if (!Number.isInteger(ddl) || ddl < 1) throw new RangeError(`tStudentQuantile : ddl entier ≥ 1, reçu ${ddl}`);
  if (p < 0.5) return -tStudentQuantile(1 - p, ddl);
  const table = T_TABLE[String(p)];
  if (table && ddl <= 30) return table[ddl - 1];
  const z = normQuantile(p);
  const v = ddl;
  return (
    z +
    (z ** 3 + z) / (4 * v) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * v ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * v ** 3) +
    (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / (92160 * v ** 4)
  );
}
