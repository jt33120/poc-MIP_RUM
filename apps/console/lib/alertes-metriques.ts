// Les métriques d'alerte et de SLO, leurs comparateurs et leurs libellés, SANS la base.
//
// Séparé de `queries-v2.ts` le 24/09/2026 (cliquet de la piste C,
// docs/architecture/console-api/README.md) : les champs d'une règle d'alerte n'ont
// besoin que de ces listes. Tant qu'ils les lisaient dans `queries-v2.ts`, leur
// graphe d'import atteignait `lib/db.ts`.

// Métriques éligibles comme CIBLE DE SLO : uniquement celles qui ont un sens
// « % de mesures conformes » (vitals + taux d'erreur). Un coût/compte absolu
// n'entre pas dans ce modèle -> exclu des SLO.
export const SLO_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB", "error_rate"] as const;

// Métriques éligibles comme RÈGLE D'ALERTE : les métriques SLO + deux métriques
// opérationnelles absolues (budget IA, pics d'erreurs applicatives) évaluées par
// check_alerts (migration-v38), puis les familles paramétrées `event:<nom>` (P4)
// et `issue:<uuid>` (P5.6, occurrences d'une issue d'erreurs).
export const ALERT_METRICS = [...SLO_METRICS, "log_errors", "event", "issue"] as const;

export const ALERT_COMPARATORS = [">", "<"] as const;

export const ISSUE_METRIC = /^issue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Libellé lisible + unité d'une métrique d'alerte/SLO (dropdowns, feed d'événements). */
export const METRIC_LABELS: Record<string, string> = {
  LCP: "LCP (ms)",
  INP: "INP (ms)",
  CLS: "CLS",
  FCP: "FCP (ms)",
  TTFB: "TTFB (ms)",
  error_rate: "Taux d'erreur JS",
  log_errors: "Logs en erreur (nombre)",
  event: "Événement personnalisé (nombre)",
  issue: "Issue d'erreurs (occurrences)",
};

/** Libellé d'une métrique (repli : la clé brute si inconnue). */
export function metricLabel(metric: string): string {
  if (metric.startsWith("event:")) return `Événement « ${metric.slice(6)} » (nombre)`;
  if (ISSUE_METRIC.test(metric)) return `Issue ${metric.slice(6, 14)} (occurrences)`;
  return METRIC_LABELS[metric] ?? metric;
}

/**
 * Libellé COURT d'une métrique, sans son unité : ce qu'une annotation dessinée
 * au-dessus d'une série, ou une phrase (« Taux d'erreur JS : 37 % »), peut porter.
 * Le même vocabulaire que les règles (`metricLabel`) : la recette du 26/09/2026
 * lisait « log_errors », « error_rate » ou « event:frustration.rage » au-dessus des
 * courbes, quand la règle, plus bas, disait « Taux d'erreur JS ».
 */
export function libelleCourtMetrique(metric: string): string {
  if (metric.startsWith("event:")) return `Événement « ${metric.slice(6)} »`;
  if (ISSUE_METRIC.test(metric)) return `Issue ${metric.slice(6, 14)}`;
  if (metric === "error_rate") return "Taux d'erreur JS";
  if (metric === "log_errors") return "Logs en erreur";
  if (metric === "event") return "Événement";
  if (metric === "issue") return "Issue d'erreurs";
  return metric === "" ? "sans métrique" : metric;
}

/**
 * La sévérité en français (« critique »), jamais la clé de la base (« critical »).
 * Ici, sans la base : le badge et les champs de règle la lisent. Une valeur
 * ancienne (`page`, `error`, `warn`) est ramenée aux trois du domaine, une
 * inconnue à « information » — la règle de `severiteConnue`.
 */
export function libelleSeverite(severity: string): string {
  if (severity === "critical" || severity === "page" || severity === "error") return "critique";
  if (severity === "warning" || severity === "warn") return "avertissement";
  return "information";
}
