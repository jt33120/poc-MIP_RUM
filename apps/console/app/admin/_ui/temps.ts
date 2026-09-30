// Le temps écoulé, écrit court pour une cellule de tableau d'administration :
// « il y a 3 min », « il y a 2 h », « il y a 5 j » (refonte du 01/10/2026).
//
// POURQUOI RELATIF. Dans une liste de jetons, de postes ou de sondes, la question est
// « depuis quand ? » ; une date absolue (« 26/09 14:03 ») oblige à soustraire de tête.
// L'instant exact reste lisible au survol et par le lecteur d'écran (`Moment`).
//
// Fonctions PURES (l'instant présent est passé en argument) : un rendu serveur et un
// test donnent le même texte, et rien ne dépend de l'horloge du navigateur.

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/** Un instant en millisecondes ; illisible → `NaN`. */
export function versMs(d: Date | string | number): number {
  return d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d);
}

/**
 * « à l'instant », « il y a 12 min », « il y a 3 h », « il y a 4 j », « il y a 2 mois ».
 * Un instant FUTUR (échéance) s'écrit « dans 5 j ». Illisible → « — », jamais une durée
 * inventée.
 */
export function ilYa(d: Date | string | number, maintenant: number): string {
  const ms = versMs(d);
  if (!Number.isFinite(ms) || !Number.isFinite(maintenant)) return "—";
  const ecart = maintenant - ms;
  const futur = ecart < 0;
  const abs = Math.abs(ecart);
  let texte: string;
  if (abs < MINUTE) return "à l'instant";
  if (abs < HEURE) texte = `${Math.floor(abs / MINUTE)} min`;
  else if (abs < JOUR) texte = `${Math.floor(abs / HEURE)} h`;
  else if (abs < 60 * JOUR) texte = `${Math.floor(abs / JOUR)} j`;
  else texte = `${Math.floor(abs / (30 * JOUR))} mois`;
  return futur ? `dans ${texte}` : `il y a ${texte}`;
}

/**
 * La part de durée RESTANTE d'une validité, de 0 à 1 : la barre d'échéance d'un jeton.
 * `null` si l'une des bornes est illisible ou si la validité est nulle.
 */
export function partRestante(debut: Date | string | number, fin: Date | string | number, maintenant: number): number | null {
  const a = versMs(debut);
  const b = versMs(fin);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.min(1, Math.max(0, (b - maintenant) / (b - a)));
}
