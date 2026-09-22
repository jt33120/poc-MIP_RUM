// Satisfaction déclarée — logique PURE (aucune I/O), testée unitairement : CSAT,
// note moyenne, répartition des notes. Les entrées sont des primitives : la couche
// SQL (queries-experience) les fournit, la couche UI les affiche.
//
// Le « score d'expérience /100 » qui vivait ici a été retiré : il pondérait au
// jugé des paliers de LCP sans source. L'écran montre désormais ses constituants
// côte à côte, chacun avec sa source.

/** Une note ≥ 4/5 (ou 👍) compte comme positive. */
export const CSAT_POSITIVE = 4;

/** Part de retours positifs (score ≥ CSAT_POSITIVE). null si aucun feedback. */
export function csatRatio(scores: number[]): number | null {
  if (!scores.length) return null;
  const pos = scores.filter((s) => s >= CSAT_POSITIVE).length;
  return pos / scores.length;
}

/** Note moyenne (1..5). null si aucun feedback. */
export function avgScore(scores: number[]): number | null {
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Répartition promoteurs (5) / passifs (3–4) / détracteurs (1–2). */
export function breakdown(scores: number[]): { promoters: number; passives: number; detractors: number } {
  let promoters = 0, passives = 0, detractors = 0;
  for (const s of scores) {
    if (s >= 5) promoters++;
    else if (s >= 3) passives++;
    else detractors++;
  }
  return { promoters, passives, detractors };
}
