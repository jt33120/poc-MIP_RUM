// Score d'expérience — logique PURE (aucune I/O), testée unitairement. Marie le
// mesuré (qualité perçue des vitals, frustration) et le déclaré (CSAT des
// feedbacks). C'est le pont « chiffres ↔ ressenti » qui distingue un DEM d'un RUM
// nu. Les entrées sont des primitives : la couche SQL (queries-experience) les
// fournit, la couche UI les affiche.

/** Une note ≥ 4/5 (ou 👍) compte comme positive. */
export const CSAT_POSITIVE = 4;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

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

export interface ExperienceInputs {
  /** Qualité perçue de la performance, 0..100 (ex. healthScore des vitals). */
  vitals: number;
  /** Pénalité de frustration déjà bornée 0..100 (rage/dead clicks -> points en moins). */
  frustrationPenalty?: number;
  /** CSAT 0..1 (part de feedbacks positifs), ou null si aucun feedback. */
  csat?: number | null;
}

/**
 * Score d'expérience /100. On part de la performance perçue, on retranche la
 * frustration, puis — si des feedbacks existent — on pondère avec la satisfaction
 * déclarée (60 % mesuré / 40 % déclaré). Sans feedback, c'est la perf ajustée.
 */
export function experienceScore({ vitals, frustrationPenalty = 0, csat = null }: ExperienceInputs): number {
  const base = clamp(vitals - frustrationPenalty, 0, 100);
  if (csat == null) return Math.round(base);
  return Math.round(0.6 * base + 0.4 * csat * 100);
}

/** Pénalité de frustration bornée à partir d'un taux pour 1000 sessions. */
export function frustrationPenalty(ratePer1k: number, cap = 20): number {
  if (!Number.isFinite(ratePer1k) || ratePer1k <= 0) return 0;
  return clamp(ratePer1k * 2, 0, cap); // 10 signaux/1k sessions -> -20 (plafond)
}

/** Palier de couleur d'un score /100 (code couleur constant : good/warn/bad). */
export function scoreTone(n: number): "good" | "warn" | "bad" {
  if (n >= 80) return "good";
  if (n >= 60) return "warn";
  return "bad";
}
