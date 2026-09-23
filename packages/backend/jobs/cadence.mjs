// Quand le prochain passage a lieu — logique PURE, sans minuterie ni base.
//
// Séparée du worker pour être testable : un scheduler dont on ne peut pas
// vérifier la grille horaire sans attendre une heure ne se vérifie jamais.

/** Les cadences, et leur signification en clair. */
export const CADENCES = {
  tick: "toutes les 5 minutes",
  horaire: "à HH:05",
  quotidien: "à 03:17 UTC",
};

/**
 * Millisecondes à attendre avant le prochain passage de `nom`.
 *
 * ALIGNÉ SUR L'HORLOGE, pas sur le démarrage. Un redéploiement à 14h03 ne doit
 * pas décaler la grille à :03, :08, :13… : les journaux deviendraient
 * incomparables d'un déploiement à l'autre, et deux instances qui se relaient
 * n'auraient pas la même grille — donc pas les mêmes fenêtres de calcul.
 *
 * Tout est en UTC, comme les fonctions SQL et l'ancien planificateur : mélanger
 * des heures locales ferait dériver la purge d'une heure deux fois par an.
 *
 * @param {"tick"|"horaire"|"quotidien"} nom
 * @param {number|Date} maintenant
 * @returns {number} délai en ms, jamais inférieur à 1000
 */
export function prochainDelai(nom, maintenant) {
  const d = new Date(maintenant);
  const suivant = new Date(d);
  suivant.setUTCSeconds(0, 0);

  if (nom === "tick") {
    // +5 après le multiple de 5 courant : à 14h58 -> setUTCMinutes(60), que la
    // date reporte d'elle-même sur 15h00. Pas de cas particulier à écrire.
    suivant.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5 + 5);
  } else if (nom === "horaire") {
    suivant.setUTCMinutes(5);
    if (suivant <= d) suivant.setUTCHours(d.getUTCHours() + 1);
  } else if (nom === "quotidien") {
    suivant.setUTCHours(3, 17, 0, 0);
    if (suivant <= d) suivant.setUTCDate(d.getUTCDate() + 1);
  } else {
    throw new Error(`cadence inconnue : ${nom}`);
  }

  // Plancher d'une seconde : à la milliseconde pile de l'échéance, le calcul
  // donnerait 0 et la minuterie repartirait en boucle serrée.
  return Math.max(1000, suivant.getTime() - d.getTime());
}
