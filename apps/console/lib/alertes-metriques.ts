// Les métriques d'alerte et de SLO, leurs comparateurs et leurs libellés, SANS la base.
//
// Séparé de `queries-v2.ts` le 24/09/2026 (cliquet de la piste C,
// docs/architecture/console-api/README.md) : les champs d'une règle d'alerte n'ont
// besoin que de ces listes. Tant qu'ils les lisaient dans `queries-v2.ts`, leur
// graphe d'import atteignait `lib/db.ts`.
import { texteSeuils, THRESHOLDS } from "./rating";
import { SEUILS_MIP, texteRegleMip, type MesureMip } from "./seuils";

// Métriques éligibles comme CIBLE DE SLO : uniquement celles qui ont un sens
// « % de mesures conformes » (vitals + taux d'erreur). Un coût/compte absolu
// n'entre pas dans ce modèle -> exclu des SLO.
export const SLO_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB", "error_rate"] as const;

/**
 * Phases réseau de la navigation et qualité du lien (vague 4, 29/09/2026) : des
 * noms de `rum_metric.name`, que la branche générique de `check_alerts` évalue
 * déjà au p75. DOWNLINK est l'exception : bas = mauvais, lu au p25 (migration-v100).
 */
export const METRIQUES_RESEAU_ALERTE = ["REDIRECT", "DNS", "TCP", "TLS", "REQUEST", "RESPONSE", "RTT", "DOWNLINK"] as const;

/**
 * Mesures MIP hors `rum_metric`, calculées par des branches de `check_alerts`
 * ajoutées en migration-v100 : quatre durées au p75 et trois parts de sessions.
 */
export const METRIQUES_MIP_ALERTE = [
  "longtask_p75",
  "loaf_p75",
  "resource_p75",
  "api_p75",
  "rage_rate",
  "dead_rate",
  "browser_error_session_rate",
] as const;

/**
 * Métriques qu'une règle ne peut surveiller qu'en SEUIL FIXE : `metric_baseline`
 * (l'écart à l'habitude) ne sait pas les calculer — il ferait un p75 horaire de
 * `rum_metric`, donc un p75 de débit contre un p25, ou rien du tout. `check_alerts`
 * rend no_data dans ce cas (v100) ; la console refuse la règle avant.
 */
export const METRIQUES_SEUIL_SEUL: readonly string[] = ["DOWNLINK", ...METRIQUES_MIP_ALERTE];

// Métriques éligibles comme RÈGLE D'ALERTE : les métriques SLO + deux métriques
// opérationnelles absolues (budget IA, pics d'erreurs applicatives) évaluées par
// check_alerts (migration-v38), puis les familles paramétrées `event:<nom>` (P4)
// et `issue:<uuid>` (P5.6, occurrences d'une issue d'erreurs). Vague 4 : les
// mesures qui ont une règle MIP (`lib/seuils.ts`), réseau et au-delà.
export const ALERT_METRICS = [
  ...SLO_METRICS,
  ...METRIQUES_RESEAU_ALERTE,
  ...METRIQUES_MIP_ALERTE,
  "log_errors",
  "event",
  "issue",
] as const;

export const ALERT_COMPARATORS = [">", "<"] as const;

/**
 * La mesure de `SEUILS_MIP` qu'une métrique d'alerte surveille. Les phases réseau
 * portent le même nom des deux côtés (`rum_metric.name`).
 */
export const MESURE_MIP_DE_METRIQUE: Record<string, MesureMip> = {
  REDIRECT: "REDIRECT",
  DNS: "DNS",
  TCP: "TCP",
  TLS: "TLS",
  REQUEST: "REQUEST",
  RESPONSE: "RESPONSE",
  RTT: "RTT",
  DOWNLINK: "DOWNLINK",
  longtask_p75: "LONGTASK",
  loaf_p75: "LOAF",
  resource_p75: "RESOURCE",
  api_p75: "API",
  rage_rate: "RAGE_CLICKS",
  dead_rate: "DEAD_CLICKS",
  browser_error_session_rate: "BROWSER_ERRORS",
};

/**
 * Les mesures de `SEUILS_MIP` qu'aucune métrique d'alerte ne surveille : leur note
 * reste de l'affichage. `SPA_LOAD` (04/10/2026) : la branche générique de
 * `check_alerts` saurait en lire le p75, mais l'ouvrir aux règles (champs, libellés,
 * API) est un lot à part.
 */
export const MESURES_MIP_SANS_ALERTE: readonly MesureMip[] = ["SPA_LOAD"];

// `hasOwnProperty` et non un accès direct : « constructor » n'est pas une métrique.
const propre = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** La mesure MIP d'une métrique d'alerte, ou `undefined`. */
function mesureMip(metric: string): MesureMip | undefined {
  return propre(MESURE_MIP_DE_METRIQUE, metric) ? MESURE_MIP_DE_METRIQUE[metric] : undefined;
}

/**
 * Le seuil « mauvais » d'une métrique d'alerte et le comparateur qui le franchit :
 * ce qu'une règle neuve propose (`RuleFields`). Vitals : la borne haute de web.dev
 * (`THRESHOLDS`, `lib/rating.ts`) ; mesures MIP : `SEUILS_MIP[...].mauvais`, avec
 * « < » pour une mesure où bas est mauvais (DOWNLINK). `null` : aucune borne
 * publiée ni MIP (erreurs, logs, événements, issues) — le champ reste vide.
 */
export function seuilMauvaisDeMetrique(metric: string): { seuil: number; comparateur: ">" | "<" } | null {
  if (propre(THRESHOLDS, metric)) return { seuil: THRESHOLDS[metric][1], comparateur: ">" };
  const mesure = mesureMip(metric);
  if (!mesure) return null;
  const s = SEUILS_MIP[mesure];
  return { seuil: s.mauvais, comparateur: s.sens === "bas-mauvais" ? "<" : ">" };
}

/**
 * D'où vient le seuil proposé, en une phrase : « LCP : bon ≤ 2,5 s, mauvais au-delà
 * de 4,0 s (web.dev) » ou `texteRegleMip` (« règle MIP : DNS > … »). Chaîne vide sans seuil.
 */
export function origineSeuilPropose(metric: string): string {
  if (propre(THRESHOLDS, metric)) return `${metric} : ${texteSeuils(metric)} (web.dev)`;
  const mesure = mesureMip(metric);
  return mesure ? texteRegleMip(mesure) : "";
}

/** Une métrique d'alerte qui est une PART (0..1) : écrite en pour cent. */
export function estPartDeMetrique(metric: string): boolean {
  if (metric === "error_rate") return true;
  const mesure = mesureMip(metric);
  return mesure !== undefined && SEUILS_MIP[mesure].unite === "part";
}

/** Une métrique d'alerte en millisecondes : un vital sauf CLS, ou une durée MIP. */
export function estDureeDeMetrique(metric: string): boolean {
  if (metric === "CLS") return false;
  if (propre(THRESHOLDS, metric)) return true;
  const mesure = mesureMip(metric);
  return mesure !== undefined && SEUILS_MIP[mesure].unite === "ms";
}

export const ISSUE_METRIC = /^issue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Libellé lisible + unité d'une métrique d'alerte/SLO (dropdowns, feed d'événements). */
export const METRIC_LABELS: Record<string, string> = {
  LCP: "LCP (ms)",
  INP: "INP (ms)",
  CLS: "CLS",
  FCP: "FCP (ms)",
  TTFB: "TTFB (ms)",
  error_rate: "Taux d'erreur JS",
  REDIRECT: "Redirection (ms, p75)",
  DNS: "DNS (ms, p75)",
  TCP: "Connexion TCP (ms, p75)",
  TLS: "TLS (ms, p75)",
  REQUEST: "Requête (ms, p75)",
  RESPONSE: "Réponse (ms, p75)",
  RTT: "Aller-retour réseau (ms, p75)",
  DOWNLINK: "Débit descendant (Mbit/s, p25)",
  longtask_p75: "Tâche longue (ms, p75)",
  loaf_p75: "Frame longue LoAF (ms, p75)",
  resource_p75: "Ressource (ms, p75)",
  api_p75: "Appel API (ms, p75)",
  rage_rate: "Clics rageurs (part des sessions)",
  dead_rate: "Clics morts (part des sessions)",
  browser_error_session_rate: "Erreurs navigateur (part des sessions)",
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
  const mesure = mesureMip(metric);
  if (mesure) return SEUILS_MIP[mesure].libelle;
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
