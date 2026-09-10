// Auto-observabilité (P1) — exposition Prometheus de la santé INTERNE de MIP RUM.
// Helpers PURS (aucun accès base ici) : forme du snapshot + mapping en métriques +
// sérialisation au format texte Prometheus. Testé unitairement.

/** Instantané de santé interne (rempli par lib/queries-health.ts). */
export interface HealthSnapshot {
  ingest_metrics_5m: number;
  ingest_pageviews_5m: number;
  ingest_errors_5m: number;
  ingest_sessions_5m: number;
  apps_active: number;
  alerts_unacked: number;
  deliveries_queued: number;
  deliveries_failed: number;
  deliveries_dead: number;
  metering_lag_hours: number | null; // null = aucun métering encore
  /** Applications ayant ATTEINT leur plafond de routes : leurs routes inédites
   *  sont regroupées sous `(other)`. Ce n'est pas une panne, c'est une perte de
   *  détail — et elle doit être visible, sinon un tableau par route ment par
   *  omission (migration-v62). */
  apps_route_capped: number;
  /** Plus grand nombre de routes distinctes retenues pour une application. */
  routes_max: number;
  /** Lots débarqués en attente de drain (ingestion différée, migration-v63).
   *  Une file qui monte veut dire que le travailleur ne suit pas — et la table
   *  est UNLOGGED, donc ce qui s'y accumule est ce qu'un redémarrage perdrait. */
  ingest_backlog: number;
  /** Lots ABANDONNÉS après cinq échecs : ils ne seront plus repris. */
  ingest_backlog_blocked: number;
  /** Âge du plus vieux lot en attente, en secondes. */
  ingest_backlog_age_s: number;
}

export interface Metric {
  name: string;
  help: string;
  type: "gauge" | "counter";
  value: number | null; // null → échantillon omis (non représentable en Prometheus)
  labels?: Record<string, string>;
}

/** Snapshot → liste de métriques Prometheus (gauges). */
export function healthToMetrics(h: HealthSnapshot): Metric[] {
  const g = (name: string, help: string, value: number | null, labels?: Record<string, string>): Metric => ({
    name, help, type: "gauge", value, labels,
  });
  return [
    g("miprum_ingest_events_5m", "Événements ingérés (5 min glissantes), par type.", h.ingest_metrics_5m, { kind: "metric" }),
    g("miprum_ingest_events_5m", "Événements ingérés (5 min glissantes), par type.", h.ingest_pageviews_5m, { kind: "pageview" }),
    g("miprum_ingest_events_5m", "Événements ingérés (5 min glissantes), par type.", h.ingest_errors_5m, { kind: "error" }),
    g("miprum_ingest_sessions_5m", "Sessions distinctes vues (5 min glissantes).", h.ingest_sessions_5m),
    g("miprum_apps_active", "Applications (tenants) actives au registre.", h.apps_active),
    g("miprum_alerts_unacked", "Événements d'alerte non acquittés.", h.alerts_unacked),
    g("miprum_alert_deliveries", "Livraisons d'alerte par statut.", h.deliveries_queued, { status: "queued" }),
    g("miprum_alert_deliveries", "Livraisons d'alerte par statut.", h.deliveries_failed, { status: "failed" }),
    g("miprum_alert_deliveries", "Livraisons d'alerte par statut.", h.deliveries_dead, { status: "dead" }),
    g("miprum_metering_lag_hours", "Ancienneté du dernier métering d'usage (heures).", h.metering_lag_hours),
    g("miprum_apps_route_capped", "Applications au plafond de cardinalité de route (routes inédites regroupées sous (other)).", h.apps_route_capped),
    g("miprum_routes_max", "Plus grand nombre de routes distinctes retenues pour une application.", h.routes_max),
    g("miprum_ingest_backlog", "Lots débarqués en attente de drain (ingestion différée).", h.ingest_backlog),
    g("miprum_ingest_backlog_blocked", "Lots abandonnés après cinq échecs d'écriture.", h.ingest_backlog_blocked),
    g("miprum_ingest_backlog_age_seconds", "Âge du plus vieux lot en attente de drain (secondes).", h.ingest_backlog_age_s),
  ];
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Sérialise des métriques au format d'exposition Prometheus (text/plain v0.0.4).
 * HELP/TYPE émis UNE fois par nom ; échantillons à valeur null omis.
 */
export function toPrometheus(metrics: Metric[]): string {
  const lines: string[] = [];
  const declared = new Set<string>();
  for (const m of metrics) {
    if (!declared.has(m.name)) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.type}`);
      declared.add(m.name);
    }
    if (m.value == null || !Number.isFinite(m.value)) continue;
    const labels = m.labels
      ? `{${Object.entries(m.labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",")}}`
      : "";
    lines.push(`${m.name}${labels} ${m.value}`);
  }
  return lines.join("\n") + "\n";
}
