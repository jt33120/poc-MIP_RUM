// Temps passé et sessions à une seule vue (P6.3) — logique PURE, testée.
//
// DEUX DÉFINITIONS, ÉCRITES ICI ET NULLE PART AILLEURS.
//
//   · `session_duration_observed = max(0, last_seen_at - started_at)`. C'est un
//     ÉCART ENTRE DEUX OBSERVATIONS, pas du temps actif : un onglet laissé ouvert
//     sans interaction l'allonge, une sortie brutale le raccourcit. Le libellé de
//     l'écran dit « durée observée », jamais « temps passé sur le site ».
//   · `single_view_session_rate = sessions à exactement une vue / sessions à au
//     moins une vue`. Ce n'est PAS un « taux de rebond » : aucune convention de
//     durée minimale, d'interaction ou de défilement n'y entre. Le mot rebond
//     recouvre trois définitions incompatibles selon les outils ; on n'en emprunte
//     aucune, et le libellé le dit.
//
// POPULATION. Seules les sessions COMMENCÉES dans la fenêtre comptent : une
// session ouverte la veille ferait entrer sa durée d'hier dans la mesure du jour.
// Celles encore actives à la fin de la fenêtre sont comptées ET signalées : leur
// durée n'est pas finie, et leur nombre de vues peut encore augmenter.

/** En dessous, rien n'est affiché : un taux sur quelques sessions se lit comme du bruit. */
export const ENGAGEMENT_MIN_SESSIONS = 30;

/** Une session vue dans les N dernières minutes de la fenêtre est réputée encore active. */
export const STILL_ACTIVE_MINUTES = 30;

export interface EngagementStats {
  /** Sessions commencées dans la fenêtre, robots exclus comme partout. */
  sessions_started: number;
  /** Parmi elles, celles qui ont au moins une page vue : le dénominateur du taux. */
  sessions_with_view: number;
  /** Parmi elles, celles qui n'ont QU'UNE page vue. */
  single_view_sessions: number;
  /** Sessions encore actives à la fin de la fenêtre (durée non finie). */
  still_active: number;
  /** Médiane de la durée observée, en secondes ; null sans échantillon. */
  duration_p50_s: number | null;
  duration_p75_s: number | null;
}

export const ENGAGEMENT_VIDE: EngagementStats = {
  sessions_started: 0,
  sessions_with_view: 0,
  single_view_sessions: 0,
  still_active: 0,
  duration_p50_s: null,
  duration_p75_s: null,
};

/** `single_view_session_rate` ; null quand le dénominateur est vide. */
export function singleViewSessionRate(stats: EngagementStats): number | null {
  return stats.sessions_with_view > 0 ? stats.single_view_sessions / stats.sessions_with_view : null;
}

/** Le jeu de données porte-t-il assez de signal pour afficher ces chiffres ? */
export function engagementSuffisant(stats: EngagementStats): boolean {
  return stats.sessions_with_view >= ENGAGEMENT_MIN_SESSIONS;
}

/** Ce qui manque, dit à l'écran plutôt qu'un chiffre affiché sans base. */
export function engagementRaison(stats: EngagementStats): string {
  return `${stats.sessions_with_view.toLocaleString("fr-FR")} session(s) avec au moins une page vue sur la fenêtre : il en faut ${ENGAGEMENT_MIN_SESSIONS} pour qu'une durée médiane et un taux de session à une vue veuillent dire quelque chose. Élargis la période.`;
}

/** Part des sessions encore actives, pour nuancer la durée affichée ; null sans population. */
export function partActive(stats: EngagementStats): number | null {
  return stats.sessions_started > 0 ? stats.still_active / stats.sessions_started : null;
}

/** Durée en secondes → « 2 min 05 s », « 45 s », « 1 h 12 min ». */
export function fmtDuree(secondes: number | null): string {
  if (secondes == null) return "—";
  const total = Math.max(0, Math.round(secondes));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${String(total % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
