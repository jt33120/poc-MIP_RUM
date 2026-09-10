// LE NOYAU STATISTIQUE DE LA MATRICE DE CORRÉLATION RUM ↔ SYNTHÉTIQUE.
//
// Pur : aucune base, aucun réseau. C'est ce qui permet de le vérifier contre des
// valeurs de référence connues plutôt que contre lui-même.
//
// ══════════════ POURQUOI CE MODULE REFUSE DE RÉPONDRE, SOUVENT ════════════════
//
// Une matrice de corrélation est l'outil le plus facile à rendre faux d'un
// produit d'observabilité. Trois pièges, et ce qu'on fait de chacun :
//
//   1. TROP PEU DE POINTS. Sur 4 heures comparées, un coefficient de 0,95 sort
//      du bruit une fois sur cinq. On ne rend donc JAMAIS un coefficient sans
//      son effectif et sa p-valeur, et en dessous de MIN_POINTS on ne rend pas
//      de coefficient du tout — on dit « pas assez de points », ce qui est
//      l'information vraie.
//
//   2. VALEURS ABERRANTES. Les latences sont à queue lourde : un seul incident
//      à 30 s peut créer une corrélation qui n'existe pas, ou en masquer une.
//      D'où Spearman (corrélation des RANGS) à côté de Pearson. Quand les deux
//      divergent franchement, c'est un signal en soi, et l'appelant peut le voir.
//
//   3. APPARIEMENT SILENCIEUX. Deux séries n'ont pas les mêmes trous. Joindre en
//      ignorant les manquants fait corréler des heures qui n'ont rien à voir.
//      `apparier` ne garde que les instants présents des DEUX côtés, et REND le
//      nombre de points écartés — une matrice calculée sur 6 heures d'une fenêtre
//      de 168 n'a pas la même valeur, et le lecteur doit le savoir.
//
// Ce qu'on ne fait pas : conclure à une causalité. Un décalage temporel qui
// maximise la corrélation SUGGÈRE un sens de propagation, il ne le prouve pas.
// `MISE_EN_GARDE` porte cette phrase jusqu'à l'écran.

/**
 * En dessous, aucun coefficient n'est rendu.
 *
 * 8 n'est pas un chiffre rond choisi au hasard : avec n = 8, il faut |r| ≥ 0,707
 * pour atteindre le seuil de 5 %. En dessous, presque n'importe quel coefficient
 * serait « significatif » et le mot perdrait son sens.
 */
export const MIN_POINTS = 8;

export const MISE_EN_GARDE =
  "Une corrélation n'est pas une cause. Un décalage qui maximise le coefficient suggère un sens " +
  "de propagation ; il ne le démontre pas.";

/** Ce qu'on rend, y compris quand on ne rend pas de coefficient. */
export interface Correlation {
  /** Pearson : la relation LINÉAIRE. `null` si indéterminable. */
  pearson: number | null;
  /** Spearman : la relation MONOTONE, sur les rangs. Robuste aux valeurs extrêmes. */
  spearman: number | null;
  /** Nombre de points appariés effectivement utilisés. */
  n: number;
  /** Points écartés faute d'être présents des deux côtés. */
  ecartes: number;
  /** p-valeur bilatérale de Pearson. `null` quand il n'y a pas de coefficient. */
  p: number | null;
  /** true seulement si p < 0,05 ET n >= MIN_POINTS. */
  significatif: boolean;
  /** Ce qu'on peut dire, en clair — y compris « rien ». */
  verdict: "insuffisant" | "aucune_variation" | "non_significatif" | "significatif";
}

/** Moyenne arithmétique. */
function moyenne(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Coefficient de Pearson, ou `null`.
 *
 * `null` quand une des deux séries est CONSTANTE : le coefficient vaut alors 0/0.
 * Rendre 0 laisserait croire « aucune corrélation » alors que la vraie réponse
 * est « une des deux ne bouge pas, la question n'a pas de sens ».
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = moyenne(xs);
  const my = moyenne(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  const r = num / Math.sqrt(dx2 * dy2);
  // L'arithmétique flottante peut sortir de [-1, 1] d'un epsilon sur des séries
  // parfaitement colinéaires ; un |r| > 1 ferait ensuite diviser par la racine
  // d'un négatif dans la p-valeur.
  return Math.min(1, Math.max(-1, r));
}

/**
 * Rangs moyens (les ex æquo partagent la moyenne de leurs rangs).
 *
 * Sans la moyenne sur les ex æquo, une série avec beaucoup de valeurs égales —
 * un état qui reste « ok » toute la journée, par exemple — produirait des rangs
 * arbitraires dépendant de l'ordre d'arrivée.
 */
export function rangs(xs: readonly number[]): number[] {
  const ordre = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < ordre.length) {
    let j = i;
    while (j + 1 < ordre.length && ordre[j + 1].v === ordre[i].v) j++;
    const rangMoyen = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[ordre[k].i] = rangMoyen;
    i = j + 1;
  }
  return out;
}

/** Spearman = Pearson sur les rangs. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  return pearson(rangs(xs), rangs(ys));
}

// ───────────────────────── p-valeur : la partie délicate ─────────────────────
//
// t = r × √((n−2) / (1−r²)) suit une loi de Student à n−2 degrés de liberté sous
// l'hypothèse nulle. La fonction de répartition passe par la fonction bêta
// incomplète régularisée, implémentée ici par la fraction continue de Lentz
// (Numerical Recipes, §6.4) — la même que celle des bibliothèques statistiques.
// Les valeurs sont vérifiées contre la table de Student dans les tests.

function lnGamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAX = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Fonction bêta incomplète régularisée I_x(a, b). */
export function betaIncomplete(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  // La fraction continue ne converge vite que d'un côté du point x = (a+1)/(a+b+2) ;
  // au-delà on utilise la symétrie I_x(a,b) = 1 − I_{1−x}(b,a).
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** p-valeur BILATÉRALE d'un t de Student à `df` degrés de liberté. */
export function pValeurStudent(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  return betaIncomplete(df / 2, 0.5, df / (df + t * t));
}

/**
 * p-valeur bilatérale d'un coefficient de corrélation.
 *
 * Rend 0 pour |r| = 1 : la fraction (n−2)/(1−r²) diverge, et la limite est bien
 * une p-valeur nulle. Le calculer naïvement donnerait Infinity puis NaN.
 */
export function pValeurCorrelation(r: number, n: number): number | null {
  if (n < 3) return null;
  if (Math.abs(r) >= 1) return 0;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return pValeurStudent(t, n - 2);
}

// ───────────────────────────── L'appariement ─────────────────────────────────

/** Un point d'une série : un instant, une valeur. */
export interface Point {
  /** Clé d'instant — un début de seau, en ISO ou en epoch. Comparée telle quelle. */
  t: string | number;
  v: number | null | undefined;
}

/**
 * Ne garde que les instants présents des DEUX côtés, avec une valeur finie.
 *
 * REND CE QU'IL A JETÉ. Une corrélation calculée sur 6 heures d'une fenêtre de
 * 168 n'a pas la même valeur qu'une corrélation calculée sur 168 ; sans ce
 * compte, les deux s'affichent pareil.
 */
export function apparier(a: readonly Point[], b: readonly Point[]): { xs: number[]; ys: number[]; ecartes: number } {
  const droite = new Map<string, number>();
  for (const p of b) {
    if (p.v != null && Number.isFinite(p.v)) droite.set(String(p.t), p.v);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  let vus = 0;
  for (const p of a) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    vus++;
    const y = droite.get(String(p.t));
    if (y === undefined) continue;
    xs.push(p.v);
    ys.push(y);
  }
  // Écartés = instants exploitables d'un côté au moins, sans vis-à-vis.
  const ecartes = vus - xs.length + (droite.size - xs.length);
  return { xs, ys, ecartes };
}

/** La corrélation complète de deux séries, avec son verdict. */
export function correler(a: readonly Point[], b: readonly Point[]): Correlation {
  const { xs, ys, ecartes } = apparier(a, b);
  const n = xs.length;
  if (n < MIN_POINTS) {
    return { pearson: null, spearman: null, n, ecartes, p: null, significatif: false, verdict: "insuffisant" };
  }
  const r = pearson(xs, ys);
  const rho = spearman(xs, ys);
  if (r === null) {
    // Une des deux séries ne varie pas. « 0 » se lirait « aucun lien » ; la
    // vérité est qu'il n'y a rien à corréler.
    return { pearson: null, spearman: rho, n, ecartes, p: null, significatif: false, verdict: "aucune_variation" };
  }
  const p = pValeurCorrelation(r, n);
  const significatif = p !== null && p < 0.05;
  return { pearson: r, spearman: rho, n, ecartes, p, significatif, verdict: significatif ? "significatif" : "non_significatif" };
}

/**
 * Corrélation en fonction d'un DÉCALAGE, en nombre de seaux.
 *
 * Sert à répondre à « le robot voit-il la dégradation avant les utilisateurs, ou
 * après ? ». On décale la seconde série de `k` seaux et on recorrèle.
 *
 * Le décalage n'est appliqué que si les instants sont des NOMBRES (epoch) ou des
 * dates ISO régulièrement espacées — sinon « décaler d'un seau » n'a pas de sens.
 * On rend donc l'indice du seau, pas une durée : c'est à l'appelant, qui connaît
 * la largeur de son seau, de la traduire en minutes.
 */
export function correlerAvecDecalage(
  a: readonly Point[],
  b: readonly Point[],
  decalageMax: number,
): { meilleur: { decalage: number; correlation: Correlation } | null; tous: { decalage: number; correlation: Correlation }[] } {
  // ORDRE DES INSTANTS — ce n'est pas un détail de tri.
  //
  // La première version faisait `b.map(p => String(p.t)).sort()`. Sur des
  // instants numériques, l'ordre lexicographique donne 0, 1, 10, 11, …, 2, 3 :
  // « décaler d'un seau » décalait alors d'une position ARBITRAIRE, et la
  // fonction rendait un « meilleur décalage » qui ne voulait rien dire — la
  // forme la plus convaincante de mensonge statistique, puisqu'elle sort un
  // chiffre plausible. C'est un test à décalage injecté qui l'a montré.
  //
  // Les chaînes ISO 8601, elles, s'ordonnent correctement en lexicographique :
  // c'est toute la raison pour laquelle ce format existe.
  const instants = [...new Set(b.map((p) => p.t))].sort((x, y) =>
    typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)),
  );
  const index = new Map<string, number>();
  instants.forEach((c, i) => index.set(String(c), i));

  const tous: { decalage: number; correlation: Correlation }[] = [];
  for (let k = -decalageMax; k <= decalageMax; k++) {
    // On décale B de k seaux : le point d'indice i est présenté à l'instant du
    // point d'indice i − k. Aucun instant n'est inventé — les points qui
    // tomberaient hors de la série sont simplement perdus, et `apparier` les
    // comptera comme écartés.
    const decale: Point[] = [];
    for (const p of b) {
      const i = index.get(String(p.t));
      if (i === undefined) continue;
      const cible = instants[i - k];
      if (cible === undefined) continue;
      decale.push({ t: cible, v: p.v });
    }
    tous.push({ decalage: k, correlation: correler(a, decale) });
  }
  const candidats = tous.filter((x) => x.correlation.significatif && x.correlation.pearson !== null);
  const meilleur = candidats.length
    ? candidats.reduce((best, x) => (Math.abs(x.correlation.pearson!) > Math.abs(best.correlation.pearson!) ? x : best))
    : null;
  return { meilleur, tous };
}
