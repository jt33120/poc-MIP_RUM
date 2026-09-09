// Seuils Core Web Vitals alignés sur la référence web.dev (E0) — miroir de
// apps/ingest/.../_shared/otlp.mjs, utilisé pour noter les agrégats p75 au rendu.
export type Rating = "good" | "needs-improvement" | "poor";

export const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

/**
 * Les cinq Core Web Vitals — DÉRIVÉS des seuils, jamais réécrits.
 *
 * POURQUOI CETTE LISTE EXISTE. `rum_metric` ne porte pas que des vitals : les
 * phases réseau d'une navigation (REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE)
 * voyagent sur le MÊME canal, parce que `rum_metric.name` est du texte libre et
 * que ça évitait une table. Elles n'ont pas de seuil Google, donc
 * `rating2026` leur rend `null` — ce qui est correct : il n'existe pas de
 * « bonne » durée de résolution DNS dans l'absolu.
 *
 * Conséquence, restée invisible des mois : toute agrégation « part des mesures
 * notées good » qui ne filtre pas sur le nom compte ces phases AU DÉNOMINATEUR
 * sans qu'elles puissent jamais passer au numérateur. Le score de santé, la
 * heatmap et le rollup horaire étaient tous les trois plafonnés — pas par la
 * performance du site, mais par le nombre de phases que le navigateur du
 * visiteur sait remonter. Un parc Chrome faisait donc un score plus bas qu'un
 * parc Safari, à performance identique.
 *
 * Le filtre est le même des trois côtés, et il vient d'ici. Côté SQL il vient de
 * `mip_core_vitals()` (migration-v56), et un test compare les deux listes.
 */
export const CORE_VITALS: readonly string[] = Object.keys(THRESHOLDS);

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
  good: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-400/10 dark:text-emerald-300 dark:border-emerald-400/30",
  "needs-improvement":
    "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/30",
  poor: "bg-red-100 text-red-800 border-red-300 dark:bg-red-400/10 dark:text-red-300 dark:border-red-400/30",
};

/** Couleur de jauge par rating (barres de seuils des VitalCards). */
export const RATING_BAR: Record<Rating, string> = {
  good: "bg-emerald-500",
  "needs-improvement": "bg-amber-500",
  poor: "bg-red-500",
};

/** Couleurs hex par rating — pour les barres/SVG (fills inline hors classes Tailwind). */
export const RATING_HEX: Record<Rating, string> = {
  good: "#059669",
  "needs-improvement": "#d97706",
  poor: "#dc2626",
};
