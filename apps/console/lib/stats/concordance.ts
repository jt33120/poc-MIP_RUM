// Concordance robot ↔ réel (épique P*, P*.8) — logique PURE, sans accès base.
//
// LA QUESTION. « Le robot suit-il ce que vivent les visiteurs dans le temps, ou
// regarde-t-il ailleurs ? » On ne peut PAS y répondre en soustrayant deux mesures :
// le robot chronomètre le premier chargement d'un scénario, le réel mesure le LCP
// de visiteurs (§ 1.5 DF1). L'écran /correlation ne compare donc jamais leurs
// valeurs — et ce module non plus.
//
// LA MÉTHODE : corrélation de RANG de Spearman entre les deux séries QUOTIDIENNES.
// Elle ne regarde que l'ordre des jours : insensible aux échelles différentes et
// aux valeurs extrêmes, elle dit si les deux montent et descendent ensemble, jamais
// si leurs valeurs sont égales. Intervalle par transformation de Fisher, avec
// l'erreur-type √(1,06 / (n − 3)) (correction usuelle pour les rangs, plus large
// que le 1 / (n − 3) de Pearson).
//
// REFUS AVANT VOLUME (RM2). Sous 10 jours communs, aucun ρ n'est rendu : un
// coefficient sur 4 points est du bruit qui a l'air d'une mesure. Un « jour
// commun » est un jour où la route a un passage du robot ET assez de mesures LCP
// réelles pour que sa p75 ait un sens (le minimum de P*.1 : 13).
import { mesuresMinimales } from "./incertitude";
import { refus, type Intervalle, type Resultat } from "./types";

/** Quantile normal à 97,5 % : le même que celui des intervalles de P*.1. */
const Z95 = 1.96;

/**
 * Jours communs minimaux. CHOIX DE PRODUIT, écrit à l'écran : en dessous, la
 * largeur de l'intervalle de Fisher couvre presque tout ]−1 ; 1[, et le
 * coefficient ne trancherait rien.
 */
export const JOURS_MIN_CONCORDANCE = 10;

/**
 * Mesures LCP réelles minimales pour qu'un jour compte : le minimum de mesures
 * sous lequel la p75 n'a pas d'intervalle (13, `mesuresMinimales()` de P*.1).
 * Lu, jamais recopié.
 */
export const MESURES_MIN_JOUR = mesuresMinimales();

/**
 * Seuil de lecture du coefficient. CHOIX DE PRODUIT (aucune norme ne le fixe),
 * écrit à l'écran à côté de chaque verdict.
 */
export const SEUIL_SUIT = 0.3;

/** La phrase qui empêche de lire ρ comme un écart de mesures. Affichée telle quelle. */
export const MENTION_RHO =
  "ρ mesure si les deux montent et descendent ensemble, pas si leurs valeurs sont égales.";

/** Un jour retenu : la valeur robot et la valeur réelle du même jour. */
export interface JourCommun {
  /** Premier chargement moyen du robot ce jour-là (ms). */
  robot: number;
  /** LCP p75 réel du même jour (ms). */
  reel: number;
}

/** Un jour lu, avant filtrage : un côté peut manquer, l'effectif réel peut être faible. */
export interface JourLu {
  robot: number | null;
  reel: number | null;
  mesures: number | null;
}

/** « suit », « ne suit pas », ou rien d'établi — jamais un verdict implicite. */
export type IssueConcordance = "suit" | "ne_suit_pas" | "non_etabli";

export interface Concordance {
  /** Coefficient de Spearman, dans [−1 ; 1]. */
  rho: number;
  /** Jours communs retenus. */
  n: number;
  intervalle: Intervalle;
  issue: IssueConcordance;
  /** Seuil de lecture employé (choix de produit, affiché). */
  seuil: number;
  /**
   * `true` quand |ρ| = 1 : la transformation de Fisher n'a pas de borne finie et
   * l'intervalle se réduit au point. C'est dit, pas masqué par une fausse largeur.
   */
  degenere: boolean;
}

/**
 * Rangs 1..n, EX-AEQUO PAR RANGS MOYENS : deux jours de même valeur partagent la
 * moyenne de leurs rangs, sinon l'ordre d'arrivée fabriquerait de la corrélation.
 */
export function rangsMoyens(valeurs: readonly number[]): number[] {
  const ordre = valeurs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const rangs = new Array<number>(valeurs.length);
  let debut = 0;
  while (debut < ordre.length) {
    let fin = debut;
    while (fin + 1 < ordre.length && ordre[fin + 1].v === ordre[debut].v) fin++;
    const moyen = (debut + fin) / 2 + 1;
    for (let k = debut; k <= fin; k++) rangs[ordre[k].i] = moyen;
    debut = fin + 1;
  }
  return rangs;
}

/** Corrélation de Pearson ; `null` si une série est constante (variance nulle). */
function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  if (sx <= 0 || sy <= 0) return null;
  const r = num / Math.sqrt(sx * sy);
  return Math.min(1, Math.max(-1, r));
}

/**
 * Coefficient de Spearman : Pearson sur les RANGS (la formule 1 − 6Σd²/(n(n²−1))
 * est fausse dès qu'il y a des ex-aequo). `null` si un côté ne varie pas : aucun
 * ordre à comparer, ce n'est pas un ρ de 0.
 */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) throw new RangeError(`spearman : deux séries de même longueur attendues, reçu ${x.length} et ${y.length}`);
  if (x.length < 3) return null;
  return pearson(rangsMoyens(x), rangsMoyens(y));
}

/** Les jours exploitables : un passage du robot ET assez de mesures LCP réelles. */
export function joursCommuns(lus: readonly JourLu[], mesuresMin = MESURES_MIN_JOUR): JourCommun[] {
  const gardes: JourCommun[] = [];
  for (const j of lus) {
    if (j.robot == null || j.reel == null) continue;
    if ((j.mesures ?? 0) < mesuresMin) continue;
    gardes.push({ robot: j.robot, reel: j.reel });
  }
  return gardes;
}

/**
 * Concordance d'une route : ρ de Spearman sur ses jours communs, intervalle de
 * Fisher à 95 %, lecture en trois issues autour du seuil (choix de produit) :
 * « suit » si la borne BASSE le dépasse, « ne suit pas » si la borne HAUTE est en
 * dessous, « non établi » entre les deux. Un intervalle qui enjambe le seuil ne
 * conclut rien, et le dit.
 */
export function concordance(
  jours: readonly JourCommun[],
  options: { joursMin?: number; seuil?: number } = {},
): Resultat<Concordance> {
  const joursMin = options.joursMin ?? JOURS_MIN_CONCORDANCE;
  const seuil = options.seuil ?? SEUIL_SUIT;
  const n = jours.length;
  if (n < joursMin) {
    return refus(`${n} jour${n > 1 ? "s" : ""} commun${n > 1 ? "s" : ""}, ${joursMin} requis`, {
      requis: joursMin,
      observe: n,
      unite: "jours communs",
    });
  }
  const rho = spearman(
    jours.map((j) => j.robot),
    jours.map((j) => j.reel),
  );
  if (rho === null) {
    return refus("une des deux séries ne varie pas d'un jour à l'autre : aucun ordre à comparer", {
      requis: 2,
      observe: 1,
      unite: "valeurs distinctes",
    });
  }
  const intervalle = intervalleFisher(rho, n);
  const issue: IssueConcordance = intervalle.bas > seuil ? "suit" : intervalle.haut < seuil ? "ne_suit_pas" : "non_etabli";
  return {
    ok: true,
    rho,
    n,
    intervalle,
    issue,
    seuil,
    degenere: Math.abs(rho) >= 1 - 1e-12,
  };
}

/**
 * Intervalle à 95 % d'un coefficient de rang par transformation de Fisher :
 * z = atanh(ρ) ± 1,96 · √(1,06 / (n − 3)), ramené par tanh. Le 1,06 est la
 * correction des rangs (l'intervalle d'un ρ de Spearman est un peu plus large que
 * celui d'un Pearson).
 *
 * À |ρ| = 1, atanh est infini : le transformé est borné plutôt que de rendre NaN,
 * et l'intervalle se réduit alors au point — `Concordance.degenere` le dit.
 */
export function intervalleFisher(rho: number, n: number): Intervalle {
  if (!(n > 3)) throw new RangeError(`intervalleFisher : n > 3 attendu, reçu ${n}`);
  const z = Math.atanh(Math.min(1 - 1e-12, Math.max(-1 + 1e-12, rho)));
  const demi = Z95 * Math.sqrt(1.06 / (n - 3));
  return { bas: Math.tanh(z - demi), haut: Math.tanh(z + demi), niveau: 0.95, methode: "fisher" };
}

/** Un coefficient s'écrit à deux décimales, en français : « 0,71 », « −0,12 ». */
export function fmtRho(v: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const VERBE: Record<IssueConcordance, string> = {
  suit: "le robot et le réel évoluent ensemble",
  ne_suit_pas: "le robot et le réel n'évoluent pas ensemble",
  non_etabli: "la concordance n'est pas établie",
};

/** « Concordance non calculée : 4 jours communs, 10 requis » — le refus, en toutes lettres. */
export function texteRefusConcordance(r: { raison: string }): string {
  return `Concordance non calculée : ${r.raison}`;
}

/**
 * La phrase du hero (P*.8) : le nombre de jours, l'issue, ρ et son intervalle,
 * puis la mention qui empêche de lire ρ comme un écart de valeurs.
 */
export function phraseConcordance(res: Resultat<Concordance>): string {
  if (!res.ok) return `${texteRefusConcordance(res)}. ${MENTION_RHO}`;
  const bornes = res.degenere
    ? " : l'ordre des jours est identique des deux côtés, l'intervalle de Fisher se réduit à ce point"
    : `, entre ${fmtRho(res.intervalle.bas)} et ${fmtRho(res.intervalle.haut)}`;
  return `Sur ${res.n} jours communs, ${VERBE[res.issue]} (ρ de Spearman = ${fmtRho(res.rho)}${bornes}). ${MENTION_RHO}`;
}

/** La même chose dans une cellule de table : « ρ 0,71 (0,21 à 0,92) », ou le refus. */
export function texteConcordanceCourt(res: Resultat<Concordance>): string {
  if (!res.ok) return texteRefusConcordance(res);
  const bornes = res.degenere ? "intervalle réduit à ce point" : `${fmtRho(res.intervalle.bas)} à ${fmtRho(res.intervalle.haut)}`;
  return `ρ ${fmtRho(res.rho)} (${bornes})`;
}

/** L'issue en toutes lettres, pour l'infobulle et l'alternative textuelle. */
export const LIBELLE_ISSUE: Record<IssueConcordance, string> = {
  suit: "suit",
  ne_suit_pas: "ne suit pas",
  non_etabli: "non établi",
};

/**
 * La règle de lecture, écrite à l'écran à côté des coefficients : le seuil est un
 * CHOIX, il est dit comme tel. La mention `MENTION_RHO` n'y est pas répétée — elle
 * accompagne déjà chaque phrase (`phraseConcordance`) ; une section qui n'affiche
 * que la règle l'ajoute elle-même.
 */
export function regleConcordance(seuil = SEUIL_SUIT, joursMin = JOURS_MIN_CONCORDANCE, mesuresMin = MESURES_MIN_JOUR): string {
  return (
    `Corrélation de rang de Spearman entre le premier chargement moyen du robot et le LCP p75 réel, jour par jour (UTC). ` +
    `Un jour commun demande un passage du robot et au moins ${mesuresMin} mesures LCP réelles ; il en faut ${joursMin}. ` +
    `« Suit » quand la borne basse dépasse ${fmtRho(seuil)}, « ne suit pas » quand la borne haute est en dessous, sinon rien n'est établi. ` +
    `Le seuil de ${fmtRho(seuil)} est un choix de produit, pas une norme.`
  );
}
