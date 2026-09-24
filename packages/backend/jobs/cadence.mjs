// Quand le prochain passage a lieu — logique PURE, sans minuterie ni base.
//
// Séparée du worker pour être testable : un scheduler dont on ne peut pas
// vérifier la grille horaire sans attendre une heure ne se vérifie jamais.

/**
 * LA CADENCE DU TICK EST RÉGLABLE, ET C'EST UNE AFFAIRE DE BUDGET (24/09/2026).
 *
 * 5 minutes est la cadence visée. Mais la base tourne sur l'offre GRATUITE de
 * Neon — 100 heures de calcul (CU-h) par mois — et Neon n'endort le calcul
 * qu'après 5 minutes sans requête : un tick toutes les 5 minutes le gardait
 * éveillé en permanence, et le quota a été épuisé le 24/09 (110 CU-h, calcul
 * suspendu jusqu'au 1er du mois). Toutes les 15 minutes, la base dort environ
 * les deux tiers du temps (~5,5 min éveillée par passage, ~65 CU-h par mois) et
 * laisse de la marge à la collecte et à la console.
 *
 * Seuls des DIVISEURS DE L'HEURE sont admis : la grille reste alignée sur :00,
 * et le passage horaire (HH:05) comme le quotidien (03:17) tombent dans la
 * fenêtre où la base est déjà réveillée par le tick de :00 ou :15 — ils ne la
 * réveillent pas une fois de plus. Le notifier s'aligne sur la même grille
 * (`NOTIFIER_INTERVAL_MS`, décalé de 45 s) pour la même raison.
 *
 * Un vrai produit RUM remet 5 : c'est une variable, pas du code. La cadence
 * effective est publiée en base (`platform_flag.scheduler_tick_min`) : la
 * vitrine la dit, au lieu d'afficher une valeur d'usine.
 */
export const TICK_VISE_MIN = 5;
export const TICKS_ADMIS_MIN = Object.freeze([5, 10, 15, 20, 30]);

/** Les cadences, et leur signification en clair. */
export function decrireCadences(tickMin = TICK_VISE_MIN) {
  return {
    tick: `toutes les ${tickMin} minutes`,
    horaire: "à HH:05",
    quotidien: "à 03:17 UTC",
  };
}
export const CADENCES = decrireCadences();

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
 * @param {{ tickMin?: number }} [options]  cadence du tick, un diviseur de l'heure
 * @returns {number} délai en ms, jamais inférieur à 1000
 */
export function prochainDelai(nom, maintenant, { tickMin = TICK_VISE_MIN } = {}) {
  const d = new Date(maintenant);
  const suivant = new Date(d);
  suivant.setUTCSeconds(0, 0);

  if (nom === "tick") {
    if (!TICKS_ADMIS_MIN.includes(tickMin)) {
      throw new RangeError(`cadence du tick hors grille : ${tickMin} (admis : ${TICKS_ADMIS_MIN.join(", ")})`);
    }
    // +N après le multiple de N courant : à 14h58 -> setUTCMinutes(60), que la
    // date reporte d'elle-même sur 15h00. Pas de cas particulier à écrire.
    suivant.setUTCMinutes(Math.floor(d.getUTCMinutes() / tickMin) * tickMin + tickMin);
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

/**
 * Au-delà de quel silence une cadence est EN RETARD, en ms — pour /ready et
 * /metrics, jamais pour la sonde Railway (/health).
 *
 * Le tick tolère trois passages manqués, comme la vitrine
 * (`apps/console/lib/etat-latence.ts`, TOLERANCE_MIN) : un redéploiement, un
 * bail tenu par l'instance sortante, une coupure de la base font sauter un
 * passage sans que rien ne soit cassé. L'horaire en tolère un ; le quotidien
 * a deux heures de marge sur sa journée.
 */
export function tolerancesMs(tickMin = TICK_VISE_MIN) {
  return Object.freeze({
    tick: 3 * tickMin * 60_000,
    horaire: 2 * 3_600_000,
    quotidien: 26 * 3_600_000,
  });
}
export const TOLERANCES_MS = tolerancesMs();
