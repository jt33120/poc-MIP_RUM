// Lectures HISTORIQUES des écrans d'usage (règles S3 et S4 du plan frontend) —
// logique PURE, sans accès base.
//
// POURQUOI CE MODULE. `/acquisition`, `/paths` et `/forms` lisent encore
// `now() - interval '…'` (CS1) : leur « 7 j » n'est pas la plage `[from, to)` du
// contrat, et ils n'appliquent ni plage personnalisée, ni tablette, ni « Inconnu ».
// Deux « 7 j » aux bornes différentes sur des écrans voisins se liraient comme la
// même fenêtre. Tant que B31 n'est pas livré, ces écrans ÉCRIVENT la fenêtre
// qu'ils ont réellement lue et l'heure de la lecture (S3), et tout plafond de
// lecture atteint est dit à côté du chiffre qu'il borne (S4). F48 est le premier
// écran à s'en servir ; F50 et F51 reprennent les mêmes textes.
import type { PeriodKey } from "./filters";

/** La fenêtre glissante d'un preset, écrite pour une phrase, avec l'accord du participe « lu ». */
const FENETRES: Record<PeriodKey, { nom: string; avecArticle: string; lu: string }> = {
  "1h": { nom: "Dernière heure glissante", avecArticle: "la dernière heure glissante", lu: "lue" },
  "24h": { nom: "24 dernières heures glissantes", avecArticle: "les 24 dernières heures glissantes", lu: "lues" },
  "7d": { nom: "7 derniers jours glissants", avecArticle: "les 7 derniers jours glissants", lu: "lus" },
};

/** Ce qu'une lecture non migrée n'applique pas (S3) : la raison est écrite, pas devinée. */
export const NOTE_LECTURE_NON_MIGREE = "lecture non migrée : ni plage personnalisée, ni tablette, ni « Inconnu »";

/** « 14:02 UTC » : l'heure de la lecture, dans le fuseau des bornes (`now()` est en UTC). */
export function heureUtc(luA: Date): string {
  const hh = String(luA.getUTCHours()).padStart(2, "0");
  const mm = String(luA.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/**
 * La fenêtre réellement lue par une lecture historique : « 7 derniers jours
 * glissants, lus à 14:02 UTC ». Glissante : elle finit à l'heure de la lecture,
 * pas à la borne `to` du contrat.
 */
export function fenetreLue(period: PeriodKey, luA: Date): string {
  const f = FENETRES[period];
  return `${f.nom}, ${f.lu} à ${heureUtc(luA)}`;
}

/** La même fenêtre dans une phrase : « Aucune session sur les 7 derniers jours glissants. » */
export function fenetreDansPhrase(period: PeriodKey): string {
  return FENETRES[period].avecArticle;
}

/** La note complète de S3, sous l'en-tête d'un écran historique. */
export function noteLectureHistorique(period: PeriodKey, luA: Date): string {
  return `${fenetreLue(period, luA)} (${NOTE_LECTURE_NON_MIGREE}).`;
}

/**
 * Un plafond de lecture est-il atteint (S4) ? Une lecture bornée par `limit n`
 * rend au plus n lignes : en rendre n veut dire qu'il pouvait y en avoir plus, et
 * le chiffre porte alors sur une partie seulement de la population. Sous le
 * plafond, rien à dire. Un plafond non positif n'est pas un plafond.
 */
export function plafondAtteint(n: number, plafond: number): boolean {
  return plafond > 0 && n >= plafond;
}
