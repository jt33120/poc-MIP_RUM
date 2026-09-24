// Liens des jours de l'écran Tendances (§ 5.20.3, TE5-TE7, F65 ; § 3.3, R-T).
//
// UN JOUR LOCAL N'EST PAS UN JOUR UTC. Les séries de /forecast découpent leurs
// journées dans le fuseau de l'app ; les fenêtres du contrat, elles, sont en UTC.
// Un point du 10/09 à Paris l'été ouvre donc `from=2026-09-09T22:00:00Z` →
// `to=2026-09-10T22:00:00Z`, pas « le 10/09 UTC » — sinon l'écran d'arrivée montre
// deux heures de la veille et perd les deux dernières heures du jour cliqué. La
// conversion est faite ICI, côté serveur (`bornesJourLocal`, F05), jamais par le
// composant client ; l'infobulle écrit les deux fuseaux (`libelleDeuxFuseaux`).
import { bornesJourLocal, libelleDeuxFuseaux } from "./fuseau-local";

export interface LienJour {
  href: string;
  /** « 10/09 00:00-24:00 Europe/Paris (09/09 22:00 - 10/09 22:00 UTC) ». */
  libelle: string;
}

/**
 * Remplit un gabarit d'URL (`{from}` / `{to}`, bruts ou déjà encodés par
 * `URLSearchParams`) avec les bornes UTC du jour local.
 */
export function lienJour(gabarit: string, jour: string, tz: string): LienJour {
  const { from, to } = bornesJourLocal(jour, tz);
  const href = gabarit
    .replace(/\{from\}|%7Bfrom%7D/gi, encodeURIComponent(from))
    .replace(/\{to\}|%7Bto%7D/gi, encodeURIComponent(to));
  return { href, libelle: libelleDeuxFuseaux(from, to, tz) };
}

/** Un lien par jour observé : la table que `ThresholdSeries` reçoit en `liensSeaux`. */
export function liensDesJours(gabarit: string, jours: readonly string[], tz: string): Record<string, LienJour> {
  return Object.fromEntries(jours.map((jour) => [jour, lienJour(gabarit, jour, tz)]));
}
