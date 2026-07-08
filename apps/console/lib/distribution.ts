// Percentiles & distribution — logique PURE, testée.
//
// Inspiré de la comparaison Matomo : un RUM sérieux ne se résume pas au p75. La
// distribution (histogramme) et la longue traîne (p90/p95/p99) racontent ce que
// le p75 cache — c'est de la technique RUM de base qui nous manquait.

/** Percentiles calculés côté SQL (percentile_cont array), dans CET ordre. */
export const PCTS = [0.5, 0.75, 0.9, 0.95, 0.99] as const;
export const PCT_LABELS = ["p50", "p75", "p90", "p95", "p99"] as const;

/** Borne haute de l'histogramme par vital (unité native : ms, sauf CLS sans unité). */
export const VITAL_CAP: Record<string, number> = {
  LCP: 6000,
  INP: 1000,
  CLS: 1,
  FCP: 6000,
  TTFB: 3000,
};

/** Nombre de tranches de l'histogramme. */
export const HISTO_BUCKETS = 20;

export interface HistoBin {
  from: number;
  to: number;
  count: number;
}

/**
 * Reconstruit des tranches contiguës à partir de la sortie de `width_bucket`.
 * width_bucket(v, 0, cap, N) rend : 0 si v<0, 1..N pour v∈[0,cap), N+1 si v≥cap.
 * On replie le débordement (N+1) dans la dernière tranche et le cas <0 (théorique)
 * dans la première — l'histogramme reste borné à [0, cap].
 */
export function histogramBins(
  rows: { bucket: number | string; count: number | string }[],
  cap: number,
  nbuckets: number = HISTO_BUCKETS,
): HistoBin[] {
  const w = cap / nbuckets;
  const counts = new Array<number>(nbuckets).fill(0);
  for (const r of rows) {
    const b = Number(r.bucket);
    const c = Number(r.count) || 0;
    if (!Number.isFinite(b)) continue;
    if (b <= 1) counts[0] += c;
    else if (b >= nbuckets + 1) counts[nbuckets - 1] += c;
    else counts[b - 1] += c;
  }
  return counts.map((count, i) => ({ from: i * w, to: (i + 1) * w, count }));
}

/** Effectif max d'un histogramme (échelle des barres). 0 si vide. */
export function maxCount(bins: HistoBin[]): number {
  return bins.reduce((m, b) => Math.max(m, b.count), 0);
}

/** Total des observations d'un histogramme. */
export function totalCount(bins: HistoBin[]): number {
  return bins.reduce((s, b) => s + b.count, 0);
}

/** Associe chaque percentile calculé à son libellé (pcts = tableau SQL ordonné). */
export function labelPercentiles(pcts: (number | null)[] | null | undefined): {
  label: string;
  value: number | null;
}[] {
  return PCT_LABELS.map((label, i) => ({
    label,
    value: pcts && pcts[i] != null && Number.isFinite(Number(pcts[i])) ? Number(pcts[i]) : null,
  }));
}
