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
  /** 0..1 vs étape 1 ; null sans départ (aucune session à l'étape 1 : pas de dénominateur, V3). */
  convFromStart: number | null;
  /** 0..1 vs étape précédente ; null quand l'étape précédente n'a aucune session. */
  convFromPrev: number | null;
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

/**
 * Assemble le rapport d'entonnoir (conversion + abandon) à partir des reached et noms.
 *
 * Un taux sans dénominateur est `null`, jamais 0 (V3, F40) : « 0 % du départ »
 * quand personne n'a commencé se lirait comme un entonnoir qui perd tout le
 * monde, alors qu'il n'y a rien à mesurer. Les abandons, eux, sont des comptes :
 * 0 reste 0.
 */
export function funnelReport(reached: number[], names: string[]): FunnelStep[] {
  const start = reached[0] ?? 0;
  return names.map((name, i) => {
    const r = reached[i] ?? 0;
    const prev = i === 0 ? r : (reached[i - 1] ?? 0);
    return {
      ord: i + 1,
      name,
      reached: r,
      convFromStart: start > 0 ? r / start : null,
      convFromPrev: prev > 0 ? r / prev : null,
      dropoff: Math.max(0, prev - r),
    };
  });
}

/** Bout-à-bout : sessions (dates par étape) + noms -> rapport. */
export function computeFunnel(sessions: (number | null)[][], names: string[]): FunnelStep[] {
  return funnelReport(funnelReached(sessions, names.length), names);
}

// ── F50 (plan § 5.13.4) ──────────────────────────────────────────────────────
// « Où décroche-t-on ? » est la question de l'entonnoir : la marche qui coûte le
// plus de sessions se lit d'un coup d'œil, plutôt qu'en comparant quatre nombres.

/**
 * L'étape qui perd le PLUS de sessions depuis la précédente, ou `null` si aucune
 * n'en perd (entonnoir parfait, ou entonnoir vide : il n'y a alors pas de « plus
 * forte perte », et en désigner une serait faux). En cas d'égalité, la première :
 * c'est elle qui prive toutes les suivantes. L'étape 1 n'est jamais candidate —
 * son abandon vaut 0 par construction (il n'y a pas d'étape avant elle).
 */
export function etapeLaPlusPerdante(steps: FunnelStep[]): number | null {
  let pire: FunnelStep | null = null;
  for (const s of steps) {
    if (s.ord === 1 || s.dropoff <= 0) continue;
    if (!pire || s.dropoff > pire.dropoff) pire = s;
  }
  return pire ? pire.ord : null;
}
