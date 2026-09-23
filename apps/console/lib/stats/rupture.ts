// P*.7 — « Depuis quand ? » : datation d'une rupture (plan § 7.2) — logique PURE,
// sans accès base (RM1), testée par tests/unit/rupture.test.ts.
//
// CE QUE LES AUTRES N'OFFRENT PAS. Datadog (anomaly, forecast, Watchdog), Grafana
// (ML forecast, outliers) et IP-Label signalent qu'une série s'écarte de son passé
// récent ; aucun des trois ne DATE un changement de niveau sur une série RUM dans
// les sources consultées. Les annotations de déploiement existent chez Grafana,
// mais elles marquent ce qu'on a fait, pas ce que la série a fait.
//
// TEST DE PETTITT, ET RIEN DE PLUS. Non paramétrique (il ne suppose ni loi normale
// ni variance constante : une p75 quotidienne n'a ni l'une ni l'autre), une seule
// rupture. `U_t` cumule les signes des comparaisons de chaque jour à tous les
// autres ; `K = max |U_t|` marque l'endroit où la série se sépare le mieux en deux,
// et `p ≈ 2·exp(−6K² / (n³ + n²))` dit si cette séparation est plus nette que ce
// que le hasard produit. Pas de détection multi-ruptures : sur 14 à 30 points, une
// seule rupture est déjà la limite de ce qui s'estime.
//
// CE QUE LE TEST PEUT DIRE À 10 JOURS. À `n = 10`, le `K` MAXIMAL possible (une
// marche parfaite coupée en son milieu) vaut 25, soit `p ≈ 0,066` : aucune série de
// dix jours ne descend sous 0,05. Le minimum de dix jours est donc un minimum de
// VALIDITÉ (en dessous, la formule asymptotique n'est plus lisible), pas de
// puissance : entre 10 et 11 jours, « aucune rupture datée » veut surtout dire
// « pas assez de jours pour en dater une », et le `p` est écrit à côté pour qu'on
// le voie. Un test le verrouille.
//
// MÉDIANES, JAMAIS UNE P75 DE PÉRIODE. Les deux niveaux comparés sont des MÉDIANES
// DE P75 QUOTIDIENNES — des p75 comparées entre elles, jamais agrégées en une p75
// de période (V5). La phrase produite le dit en toutes lettres.
//
// RM5 — AUCUN TEXTE DE CE MODULE NE PARLE DE CAUSE. Un déploiement à ± 1 jour est
// cité comme une COÏNCIDENCE DE DATE ; la réserve d'interprétation (« pas une cause
// établie ») est écrite par l'écran qui affiche, pas ici. Un test de gabarit
// interdit le mot dans tout ce que ce module produit.
import { mesuresMinimales } from "./incertitude";
import { formaterP } from "./surrepresentation";
import { refus, type Resultat } from "./types";
import type { Annotation } from "../series";

/** Jours valides sous lesquels aucune datation n'est tentée (P*.7). */
export const JOURS_VALIDES_REQUIS_RUPTURE = 10;

/** Un jour n'est valide que s'il porte au moins ce nombre de mesures (P*.1 : 13 pour une p75). */
export const MESURES_MIN_JOUR_RUPTURE = mesuresMinimales();

/** Au-delà, la séparation n'est pas retenue : la série n'a pas de rupture datée. */
export const SEUIL_P_RUPTURE = 0.05;

/** Un déploiement n'est cité que s'il tombe à ce nombre de jours de la rupture. */
export const ECART_DEPLOIEMENT_JOURS = 1;

/** La règle, écrite à côté du résultat (RM4). */
export const REGLE_RUPTURE =
  `test de Pettitt (une rupture, non paramétrique), retenue sous p = ${formaterP(SEUIL_P_RUPTURE)} ; ` +
  `jour valide = au moins ${MESURES_MIN_JOUR_RUPTURE} mesures, ${JOURS_VALIDES_REQUIS_RUPTURE} jours valides requis ; ` +
  `journée en cours exclue`;

/** Un jour de la série quotidienne : sa valeur et l'effectif qui la fonde. */
export interface JourMesure {
  /** « AAAA-MM-JJ », découpé dans le fuseau de l'application. */
  jour: string;
  /** p75 du jour ; `null` = jour sans valeur (trou), jamais 0. */
  valeur: number | null;
  /** Mesures du jour ; absent = l'appelant a déjà filtré les jours creux. */
  effectif?: number | null;
}

export interface Rupture {
  /** Premier jour du NOUVEAU niveau : le changement s'est produit entre lui et le précédent. */
  jour: string;
  /** Dernier jour de l'ANCIEN niveau. */
  jourPrecedent: string;
  /** p du test de Pettitt au point retenu. */
  p: number;
  /** `max |U_t|` : la statistique du test, écrite pour qui veut refaire le calcul. */
  K: number;
  /** Jours valides du test (les deux segments réunis). */
  joursValides: number;
  medianeAvant: number;
  medianeApres: number;
  joursAvant: number;
  joursApres: number;
  sens: "hausse" | "baisse";
}

export interface Datation {
  /** `null` : aucune rupture retenue — ce n'est pas un refus, c'est un constat. */
  rupture: Rupture | null;
  joursValides: number;
  /** p de la meilleure séparation, retenue ou non : il est écrit à l'écran. */
  p: number | null;
  regle: string;
}

/** Un déploiement ramené au jour de l'app (`deploy_marker`), pour la coïncidence de date. */
export interface DeploiementJour {
  jour: string;
  version: string | null;
}

// ────────────────────────────── Outils de série ──────────────────────────────

/** Médiane d'une liste non vide, moyenne des deux valeurs centrales si elle est paire. */
export function mediane(valeurs: readonly number[]): number {
  const tries = [...valeurs].sort((a, b) => a - b);
  const m = tries.length >> 1;
  return tries.length % 2 === 1 ? tries[m] : (tries[m - 1] + tries[m]) / 2;
}

/** « 16/09 » d'une clé de jour « AAAA-MM-JJ » (une étiquette, lue sans fuseau). */
export function jourCourt(jour: string): string {
  const [, m, j] = jour.split("-");
  return m && j ? `${j}/${m}` : "—";
}

/** Nombre de jours calendaires de `b` à `a` (étiquettes, sans fuseau) ; `NaN` si illisible. */
export function ecartJours(a: string, b: string): number {
  const ms = (jour: string) => {
    const [an, mo, j] = jour.split("-").map(Number);
    return Number.isFinite(an) && Number.isFinite(mo) && Number.isFinite(j) ? Date.UTC(an, mo - 1, j) : Number.NaN;
  };
  return Math.round((ms(a) - ms(b)) / 86_400_000);
}

// ──────────────────────────────── Test de Pettitt ────────────────────────────────

/**
 * Test de Pettitt sur une série ORDONNÉE et sans trou.
 *
 * `U_t = U_{t−1} + Σ_j sgn(x_t − x_j)` (la forme récurrente du double comptage),
 * `K = max_t |U_t|` sur `t` de 1 à n−1 — un point de rupture laisse au moins un
 * jour de chaque côté. `p ≈ 2·exp(−6K² / (n³ + n²))`, borné à 1.
 *
 * `t` rendu est l'indice 0-based du DERNIER jour du premier niveau. `null` sous
 * deux points (il n'y a alors rien à séparer).
 */
export function pettitt(xs: readonly number[]): { t: number; K: number; p: number } | null {
  const n = xs.length;
  if (n < 2 || xs.some((x) => !Number.isFinite(x))) return null;
  let u = 0;
  let K = 0;
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    let v = 0;
    for (let j = 0; j < n; j++) v += Math.sign(xs[i] - xs[j]);
    u += v;
    if (Math.abs(u) > K) {
      K = Math.abs(u);
      t = i;
    }
  }
  const p = Math.min(1, 2 * Math.exp((-6 * K * K) / (n ** 3 + n ** 2)));
  return { t, K, p };
}

/**
 * Date une rupture sur une série quotidienne, ou dit ce qui manque (RM2).
 *
 * Les jours SANS valeur et les jours sous `mesuresMin` sont écartés AVANT le test :
 * un trou n'est pas un zéro, et une p75 calculée sur cinq mesures n'est pas
 * comparable à une p75 calculée sur mille. Les jours retenus gardent leur ordre ;
 * le test ne connaît que cet ordre, pas l'espacement (un trou d'un jour ne décale
 * donc rien, il rapproche seulement deux jours voisins).
 *
 * La journée en cours doit être exclue par l'appelant (jour partiel jamais jugé).
 */
export function daterRupture(
  serie: readonly JourMesure[],
  {
    mesuresMin = MESURES_MIN_JOUR_RUPTURE,
    joursRequis = JOURS_VALIDES_REQUIS_RUPTURE,
    seuilP = SEUIL_P_RUPTURE,
  }: { mesuresMin?: number; joursRequis?: number; seuilP?: number } = {},
): Resultat<Datation> {
  const valides = serie.filter(
    (j) => j.valeur != null && Number.isFinite(j.valeur) && (j.effectif == null || j.effectif >= mesuresMin),
  );
  if (valides.length < joursRequis) {
    return refus(`datation non tentée : ${valides.length} jours valides, ${joursRequis} requis`, {
      requis: joursRequis,
      observe: valides.length,
      unite: "jours valides",
    });
  }

  const xs = valides.map((j) => j.valeur as number);
  const test = pettitt(xs);
  const base = { joursValides: xs.length, regle: REGLE_RUPTURE };
  if (!test) return { ok: true, rupture: null, p: null, ...base };
  if (!(test.p < seuilP)) return { ok: true, rupture: null, p: test.p, ...base };

  const avant = xs.slice(0, test.t + 1);
  const apres = xs.slice(test.t + 1);
  const medianeAvant = mediane(avant);
  const medianeApres = mediane(apres);
  return {
    ok: true,
    p: test.p,
    ...base,
    rupture: {
      jour: valides[test.t + 1].jour,
      jourPrecedent: valides[test.t].jour,
      p: test.p,
      K: test.K,
      joursValides: xs.length,
      medianeAvant,
      medianeApres,
      joursAvant: avant.length,
      joursApres: apres.length,
      sens: medianeApres >= medianeAvant ? "hausse" : "baisse",
    },
  };
}

/**
 * Le déploiement le plus proche du jour de la rupture, à `ecart` jours au plus, ou
 * `null`. À égalité de distance, celui qui porte une version : c'est celui qu'on
 * peut nommer et comparer (`cmp=release`).
 */
export function deploiementCoincident(
  jour: string,
  deploiements: readonly DeploiementJour[],
  ecart = ECART_DEPLOIEMENT_JOURS,
): DeploiementJour | null {
  let retenu: DeploiementJour | null = null;
  let meilleur = Number.POSITIVE_INFINITY;
  for (const d of deploiements) {
    const distance = Math.abs(ecartJours(d.jour, jour));
    if (!Number.isFinite(distance) || distance > ecart) continue;
    if (distance < meilleur || (distance === meilleur && retenu?.version == null && d.version != null)) {
      retenu = d;
      meilleur = distance;
    }
  }
  return retenu;
}

// ─────────────────────────────────── Textes ───────────────────────────────────

/**
 * La phrase publiée quand une rupture est datée (RM3, RM4).
 *
 * « Le LCP p75 a changé de niveau autour du 16/09 : médiane des p75 quotidiennes de
 *   1,9 s sur les 5 jours d'avant, 2,7 s sur les 8 jours d'après (test de Pettitt,
 *   p = 0,01, 13 jours valides). Un déploiement (1.4.2) a eu lieu le 16/09 :
 *   coïncidence de date. »
 *
 * `nom` porte son article (« Le LCP p75 »). L'écran qui l'affiche ajoute, lui, la
 * réserve d'interprétation (RM5).
 */
export function phraseRupture(
  r: Rupture,
  nom: string,
  formate: (v: number) => string,
  deploiement: DeploiementJour | null = null,
): string {
  const phrase =
    `${nom} a changé de niveau autour du ${jourCourt(r.jour)} : médiane des p75 quotidiennes de ` +
    `${formate(r.medianeAvant)} sur les ${r.joursAvant} jours d'avant, ${formate(r.medianeApres)} sur les ` +
    `${r.joursApres} jours d'après (test de Pettitt, p = ${formaterP(r.p)}, ${r.joursValides} jours valides).`;
  if (!deploiement) return phrase;
  const quoi = deploiement.version ? `Un déploiement (${deploiement.version})` : "Un déploiement sans version";
  return `${phrase} ${quoi} a eu lieu le ${jourCourt(deploiement.jour)} : coïncidence de date.`;
}

/**
 * La phrase publiée quand AUCUNE rupture n'est datée. Si une tendance est par
 * ailleurs établie, la série évolue sans marche : on le dit plutôt que de laisser
 * croire qu'il ne se passe rien.
 */
export function phraseSansRupture(d: Datation, tendanceEtablie = false): string {
  const chiffres = `test de Pettitt, p = ${d.p === null ? "—" : formaterP(d.p)}, ${d.joursValides} jours valides`;
  return tendanceEtablie
    ? `Évolution progressive, pas de rupture datée (${chiffres}).`
    : `Aucune rupture datée (${chiffres}).`;
}

/**
 * L'annotation verticale de la rupture (§ 3.7). `instant` est le premier instant du
 * jour local, calculé par l'écran (`bornesJourLocal`) : ce module ne connaît pas les
 * fuseaux. `href` ouvre la plage de ce jour.
 */
export function annotationRupture(r: Rupture, instant: string, href?: string): Annotation {
  return {
    t: instant,
    libelle: `Rupture à la ${r.sens}`,
    type: "rupture",
    ...(href ? { href } : {}),
  };
}
