// Incertitude des chiffres clés (épique P*, P*.1) — logique PURE, sans accès base.
//
// POURQUOI. À des millions de sessions, l'intervalle autour d'une p75 est
// négligeable ; à 13 mesures, il change le verdict. Un LCP p75 de 2,4 s mesuré sur
// 15 pages vues peut aussi bien être à 2,1 s qu'à 3,0 s : afficher « Bon » en vert
// sans le dire, c'est affirmer plus que la donnée.
//
// Méthodes, choisies pour ne faire AUCUNE hypothèse sur la forme de la loi :
//   - p75 : intervalle par statistiques d'ordre (rangs de la loi binomiale) ;
//   - proportions : Wilson, correct à petit effectif et près de 0 % ou 100 %.
import { binomCdf } from "./lois";
import { refus, type Intervalle, type Resultat } from "./types";

/** Quantile normal à 97,5 % arrondi comme dans le plan : la requête SQL emploie le même. */
export const Z95 = 1.96;
/** Quantile de la puissance à 80 % (écart détectable). */
const Z80 = 0.84;
/** Le quantile que la console résume : la p75 des Web Vitals. */
export const Q75 = 0.75;
/** À partir de ce nombre de mesures, les rangs normaux (calculables en SQL) remplacent les rangs exacts. */
export const SEUIL_RANGS_NORMAUX = 30;

// Tolérance d'arrondi des sommes de probabilités : une queue qui vaut 0,025
// exactement doit passer, pas échouer sur le 17ᵉ chiffre.
const EPS = 1e-12;

export interface Rangs {
  /** Rang (1..n) de la borne basse dans les mesures triées. */
  r: number;
  /** Rang (1..n) de la borne haute. */
  s: number;
  /** P(r ≤ B ≤ s − 1), B ~ Binomiale(n ; q) : la probabilité que l'intervalle contienne le vrai quantile. */
  couverture: number;
}

/** Couverture des rangs (r, s) pour le quantile q sur n mesures. */
export function couvertureRangs(n: number, r: number, s: number, q = Q75): number {
  return binomCdf(s - 1, n, q) - binomCdf(r - 1, n, q);
}

function rangsExacts(n: number, q: number, niveau: number): { r: number; s: number } | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const queue = (1 - niveau) / 2;
  // r : le plus grand rang tel que P(B ≤ r − 1) ≤ queue (risque que le vrai
  // quantile soit SOUS x(r)).
  let r = 0;
  for (let k = 1; k <= n; k++) {
    if (binomCdf(k - 1, n, q) <= queue + EPS) r = k;
    else break;
  }
  // s : le plus petit rang tel que P(B ≥ s) ≤ queue (risque qu'il soit AU-DESSUS de x(s)).
  let s = 0;
  for (let k = n; k >= 1; k--) {
    if (1 - binomCdf(k - 1, n, q) <= queue + EPS) s = k;
    else break;
  }
  return r >= 1 && s >= 1 && r < s ? { r, s } : null;
}

const minimaCaches = new Map<string, number>();

/** Le plus petit nombre de mesures pour lequel un intervalle bilatéral existe (13 pour la p75 à 95 %). */
export function mesuresMinimales(q = Q75, niveau = 0.95): number {
  const cle = `${q}|${niveau}`;
  const connu = minimaCaches.get(cle);
  if (connu != null) return connu;
  let n = 1;
  while (!rangsExacts(n, q, niveau)) n++;
  minimaCaches.set(cle, n);
  return n;
}

/**
 * Rangs EXACTS d'un intervalle de quantile, règle à queues égales : chaque côté
 * garde un risque ≤ 2,5 %, la couverture est donc ≥ 95 % par construction. Refus
 * sous le minimum (n ≤ 12 pour la p75) : aucune borne haute ne tient alors, car
 * P(B = n) = 0,75ⁿ > 0,025.
 */
export function rangsQuantileExact(n: number, q = Q75, niveau = 0.95): Resultat<Rangs> {
  const rs = rangsExacts(n, q, niveau);
  if (!rs) {
    const requis = mesuresMinimales(q, niveau);
    return refus(`${n} mesure${n > 1 ? "s" : ""}, ${requis} requises`, { requis, observe: n, unite: "mesures" });
  }
  return { ok: true, ...rs, couverture: couvertureRangs(n, rs.r, rs.s, q) };
}

/**
 * Rangs NORMAUX, pour n ≥ 30 : la même formule tourne en SQL, dans le balayage
 * qui calcule déjà la p75 (lib/queries.ts, `vitalsP75`). Couverture vérifiée ≥ 95 %
 * pour tout n de 30 à 5 000 par la binomiale exacte (tests/unit/stats-incertitude.test.ts).
 */
export function rangsQuantileNormal(n: number, q = Q75): { r: number; s: number } {
  const ecart = Z95 * Math.sqrt(n * q * (1 - q));
  const r = Math.max(1, Math.floor(q * n - ecart));
  const s = Math.min(n, Math.ceil(q * n + ecart) + 1);
  return { r, s };
}

/**
 * Les mêmes rangs, écrits en SQL : `vitalsP75` les emploie, et le test SQL les
 * compare à `rangsQuantileNormal` pour tout n de 30 à 5 000. Opérations en float8
 * dans le même ordre que le JS, pour tomber sur les mêmes entiers.
 *
 * @param n expression SQL du nombre de mesures (ex. `count(*)`)
 * @param z expression SQL du quantile normal (ex. un paramètre lié `$3`)
 */
export function rangsQuantileNormalSql(n: string, z: string): { r: string; s: string } {
  const ecart = `${z}::float8 * sqrt(0.1875::float8 * ${n})`;
  return {
    r: `greatest(1, floor(0.75::float8 * ${n} - ${ecart}))::int`,
    s: `least(${n}, ceil(0.75::float8 * ${n} + ${ecart}) + 1)::int`,
  };
}

/**
 * Intervalle à 95 % de la p75 de mesures DÉJÀ TRIÉES par ordre croissant. Rangs
 * exacts sous 30 mesures, normaux au-delà ; refus sous 13.
 */
export function intervalleQuantile(triees: readonly number[], q = Q75): Resultat<Intervalle & { n: number }> {
  const n = triees.length;
  if (n < SEUIL_RANGS_NORMAUX) {
    const rangs = rangsQuantileExact(n, q);
    if (!rangs.ok) return rangs;
    return { ok: true, bas: triees[rangs.r - 1], haut: triees[rangs.s - 1], niveau: 0.95, methode: "quantile_exact", n };
  }
  const { r, s } = rangsQuantileNormal(n, q);
  return { ok: true, bas: triees[r - 1], haut: triees[s - 1], niveau: 0.95, methode: "quantile_normal", n };
}

/** Intervalle de Wilson à 95 % d'une proportion k / n. Refus sans dénominateur. */
export function wilson(k: number, n: number, z = Z95): Resultat<Intervalle> {
  if (!(n > 0)) return refus("aucune observation au dénominateur", { requis: 1, observe: 0, unite: "observations" });
  if (k < 0 || k > n) throw new RangeError(`wilson : 0 ≤ k ≤ n attendu, reçu k=${k}, n=${n}`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const demi = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { ok: true, bas: Math.max(0, centre - demi), haut: Math.min(1, centre + demi), niveau: 0.95, methode: "wilson" };
}

/**
 * Intervalle de Newcombe (méthode hybride par scores) sur la DIFFÉRENCE de deux
 * proportions pA − pB. S'il contient 0, l'écart n'est pas établi.
 */
export function newcombe(kA: number, nA: number, kB: number, nB: number): Resultat<Intervalle & { difference: number }> {
  const a = wilson(kA, nA);
  if (!a.ok) return a;
  const b = wilson(kB, nB);
  if (!b.ok) return b;
  const pA = kA / nA;
  const pB = kB / nB;
  const d = pA - pB;
  return {
    ok: true,
    difference: d,
    bas: d - Math.sqrt((pA - a.bas) ** 2 + (b.haut - pB) ** 2),
    haut: d + Math.sqrt((a.haut - pA) ** 2 + (pB - b.bas) ** 2),
    niveau: 0.95,
    methode: "newcombe",
  };
}

/**
 * Règle de trois : zéro événement sur n observations laisse une part réelle
 * jusqu'à 3/n à 95 %. « 0 erreur sur 30 sessions » veut dire « au plus 10 % ».
 */
export function regleDeTrois(n: number): Resultat<{ haut: number }> {
  if (!(n > 0)) return refus("aucune observation", { requis: 1, observe: 0, unite: "observations" });
  return { ok: true, haut: Math.min(1, 3 / n) };
}

/**
 * Plus petit écart de proportion détectable entre deux groupes (risque 5 %
 * bilatéral, puissance 80 %), autour d'une proportion p.
 */
export function ecartDetectable(p: number, nA: number, nB: number): number {
  return (Z95 + Z80) * Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB));
}

/** Intervalle affichable d'une p75, ou la raison de son absence (écrite telle quelle à l'écran). */
export type IntervalleP75 = Intervalle | { indisponible: string };

/**
 * L'intervalle d'une p75 à partir de ce que la requête a lu : les mesures triées
 * sous 30 (rangs exacts, en JS), les deux statistiques d'ordre au-delà (rangs
 * normaux, en SQL, par la même formule que `rangsQuantileNormal`).
 */
export function intervalleP75Lu(
  n: number,
  valeurs: readonly number[] | null,
  bas: number | null,
  haut: number | null,
): IntervalleP75 {
  if (n < SEUIL_RANGS_NORMAUX) {
    const res = intervalleQuantile((valeurs ?? []).map(Number));
    return res.ok ? { bas: res.bas, haut: res.haut, niveau: 0.95, methode: res.methode } : { indisponible: res.raison };
  }
  if (bas == null || haut == null) return { indisponible: "bornes de l'intervalle non lues" };
  return { bas: Number(bas), haut: Number(haut), niveau: 0.95, methode: "quantile_normal" };
}

/**
 * L'intervalle de Wilson d'une proportion, sous la forme que prennent les tuiles
 * (`KpiTile.intervalle`). `null` SANS DÉNOMINATEUR : la valeur elle-même est alors
 * `null` avec sa raison (invariant V3), et il n'y a pas d'intervalle à dire.
 *
 * Un numérateur supérieur au dénominateur n'est pas une proportion (ex. des
 * sessions en erreur comptées sur une table, les sessions sur une autre) : on le
 * DIT plutôt que de jeter ou de rogner — un intervalle rogné à 100 % aurait l'air
 * d'une mesure.
 */
export function intervalleWilson(k: number | null | undefined, n: number | null | undefined): IntervalleP75 | null {
  if (n == null || !(n > 0) || k == null || !Number.isFinite(k)) return null;
  if (k < 0 || k > n) return { indisponible: `numérateur (${k}) hors de [0 ; ${n}] : ce n'est pas une proportion` };
  const w = wilson(k, n);
  return w.ok ? { bas: w.bas, haut: w.haut, niveau: 0.95, methode: "wilson" } : { indisponible: w.raison };
}

/** Sous ce dénominateur, une proportion porte « échantillon faible » à côté de son intervalle (P*.1, P3). */
export const FAIBLE_SOUS_PROPORTION = 30;

/**
 * L'intervalle écrit en mots (RM3) : « entre 3,5 % et 25,6 % (95 %) », ou
 * pourquoi il manque. `null` quand il n'y a rien à dire (pas de dénominateur).
 */
export function texteIntervalle(i: IntervalleP75 | null | undefined, fmt: (v: number) => string): string | null {
  if (!i) return null;
  if ("indisponible" in i) return `intervalle non calculable : ${i.indisponible}`;
  return `entre ${fmt(i.bas)} et ${fmt(i.haut)} (95 %)`;
}

/**
 * Ce qu'une tuile a le droit de dire d'un écart à la période précédente (P*.1,
 * règle P4). `etabli: false` : l'écart observé reste écrit, mais sans couleur ni
 * flèche, avec la règle qui le rend non établi.
 */
export type Ecart = { etabli: boolean; regle: string };

/**
 * Écart de deux PROPORTIONS (courante A, précédente B) : intervalle de Newcombe
 * sur la différence ; s'il contient 0, l'écart n'est pas établi. `null` quand
 * l'une des deux n'a pas de dénominateur (rien à comparer).
 */
export function ecartProportions(kA: number, nA: number, kB: number, nB: number): Ecart | null {
  if (!(nA > 0) || !(nB > 0) || kA < 0 || kB < 0 || kA > nA || kB > nB) return null;
  const d = newcombe(kA, nA, kB, nB);
  if (!d.ok) return null;
  const pts = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`;
  const bornes = `de ${pts(d.bas)} à ${pts(d.haut)} points (Newcombe, 95 %)`;
  return d.bas <= 0 && d.haut >= 0
    ? { etabli: false, regle: `écart non établi : la différence est ${bornes}, zéro compris` }
    : { etabli: true, regle: `différence ${bornes}` };
}

/**
 * Écart de deux p75 : AUCUN TEST (le plan le refuse, faute de loi de la
 * différence de deux quantiles à ce volume). Les deux intervalles sont comparés :
 * s'ils se chevauchent, l'écart n'est pas établi. C'est conservateur — un
 * chevauchement n'établit pas non plus l'ABSENCE d'écart, et le texte ne le
 * prétend pas. Un intervalle manquant d'un côté suffit à ne rien établir.
 *
 * @param fmt formate une borne (« 2,10 s ») pour écrire l'intervalle précédent
 */
export function ecartP75(
  courant: IntervalleP75 | undefined,
  precedent: IntervalleP75 | undefined,
  fmt: (v: number) => string = String,
): Ecart | null {
  if (!courant || !precedent) return null;
  if ("indisponible" in courant || "indisponible" in precedent) {
    return { etabli: false, regle: "écart non établi : intervalle non calculable sur l'une des deux périodes" };
  }
  const autre = `période précédente entre ${fmt(precedent.bas)} et ${fmt(precedent.haut)}`;
  return courant.bas <= precedent.haut && precedent.bas <= courant.haut
    ? { etabli: false, regle: `écart non établi : intervalles à 95 % qui se chevauchent (${autre})` }
    : { etabli: true, regle: `intervalles à 95 % disjoints (${autre})` };
}
