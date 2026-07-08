// Entonnoir de conversion — logique PURE et testée (Lot 6c, à la Matomo/GA).
// Un funnel = suite ORDONNÉE d'étapes (noms d'événements custom). Une session
// « atteint » l'étape k si elle a réalisé les étapes 1..k dans l'ordre temporel
// (première occurrence de chaque étape non décroissante). On dérive, par étape :
// le nombre de sessions atteintes, la conversion (vs départ et vs étape précédente)
// et l'abandon. Le SQL (queries-funnel) fournit les premières dates par étape ;
// cette logique en est la définition de référence.

export interface FunnelStep {
  ord: number; // 1-indexé
  name: string;
  reached: number; // sessions ayant atteint cette étape
  convFromStart: number; // 0..1 vs étape 1
  convFromPrev: number; // 0..1 vs étape précédente
  dropoff: number; // sessions perdues depuis l'étape précédente
}

/**
 * Profondeur atteinte par une session : plus grand préfixe d'étapes toutes présentes
 * ET en ordre temporel non décroissant. `firsts[i]` = 1re date (ms/epoch) de l'étape i,
 * ou null si absente.
 */
export function reachedDepth(firsts: (number | null)[]): number {
  let depth = 0;
  let prev = -Infinity;
  for (let i = 0; i < firsts.length; i++) {
    const t = firsts[i];
    if (t == null || t < prev) break;
    prev = t;
    depth = i + 1;
  }
  return depth;
}

/** Compte, par étape (0-indexé), le nombre de sessions l'ayant atteinte. */
export function funnelReached(sessions: (number | null)[][], stepCount: number): number[] {
  const reached = new Array(stepCount).fill(0) as number[];
  for (const s of sessions) {
    const depth = reachedDepth(s);
    for (let i = 0; i < depth; i++) reached[i]++;
  }
  return reached;
}

/** Assemble le rapport d'entonnoir (conversion + abandon) à partir des reached et noms. */
export function funnelReport(reached: number[], names: string[]): FunnelStep[] {
  const start = reached[0] ?? 0;
  return names.map((name, i) => {
    const r = reached[i] ?? 0;
    const prev = i === 0 ? r : (reached[i - 1] ?? 0);
    return {
      ord: i + 1,
      name,
      reached: r,
      convFromStart: start > 0 ? r / start : 0,
      convFromPrev: prev > 0 ? r / prev : i === 0 ? 1 : 0,
      dropoff: Math.max(0, prev - r),
    };
  });
}

/** Bout-à-bout : sessions (dates par étape) + noms -> rapport. */
export function computeFunnel(sessions: (number | null)[][], names: string[]): FunnelStep[] {
  return funnelReport(funnelReached(sessions, names.length), names);
}
