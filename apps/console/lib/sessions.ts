// Visites & récurrence — logique PURE, testée.
//
// Inspiré du modèle de visite Matomo : une « session » client peut s'étaler sur
// des heures (onglet laissé ouvert), ce qui fausse les métriques PAR session. Une
// VISITE = suite d'activité sans trou de plus de 30 min (standard analytics). On
// dérive les visites au requêtage (pas de re-tracking). Cette logique pure est la
// définition de référence ; le SQL (queries.visitStats) la reflète.

/** Seuil d'inactivité qui clôt une visite (30 min, standard analytics). */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/**
 * Nombre de visites dans une session : 1 + un incrément à chaque trou > gap.
 * Les horodatages (ms) sont triés et nettoyés ; série vide -> 0 visite.
 */
export function splitVisits(timestampsMs: number[], gapMs: number = VISIT_GAP_MS): number {
  const sorted = timestampsMs.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  let visits = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gapMs) visits++;
  }
  return visits;
}

/**
 * Une session est « revenante » si le VISITEUR (visitor_id) a une activité
 * ANTÉRIEURE à son démarrage — sinon « nouvelle ». Une session sans identifiant
 * de visiteur n'est ni l'un ni l'autre : elle ne passe pas par ici.
 */
export function isReturning(previousStartsMs: number[], thisStartMs: number): boolean {
  return previousStartsMs.some((t) => t < thisStartMs);
}
