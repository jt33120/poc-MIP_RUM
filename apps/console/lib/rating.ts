// Seuils 2026 (PLAN annexe B) — miroir de apps/ingest/.../_shared/otlp.mjs,
// utilisé pour noter les agrégats p75 au rendu.
export type Rating = "good" | "needs-improvement" | "poor";

const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2000, 2500],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rating2026(name: string, value: number): Rating | null {
  const t = THRESHOLDS[name];
  if (!t) return null;
  return value <= t[0] ? "good" : value <= t[1] ? "needs-improvement" : "poor";
}

export const RATING_LABEL: Record<Rating, string> = {
  good: "Bon",
  "needs-improvement": "À améliorer",
  poor: "Mauvais",
};

export const RATING_CLASS: Record<Rating, string> = {
  good: "bg-emerald-100 text-emerald-800 border-emerald-300",
  "needs-improvement": "bg-amber-100 text-amber-800 border-amber-300",
  poor: "bg-red-100 text-red-800 border-red-300",
};
