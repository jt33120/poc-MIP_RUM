// Auto-observabilité (P1) — santé INTERNE de MIP RUM (lecture seule). Toutes les
// tables sont déjà lisibles par console_ro (v16). Fail-soft : un snapshot à zéros si
// la base bronche (l'endpoint /metrics ne doit jamais 500 sur un hoquet transitoire).
import { q } from "./db";
import type { HealthSnapshot } from "./metrics-format";

const ZERO: HealthSnapshot = {
  ingest_metrics_5m: 0, ingest_pageviews_5m: 0, ingest_errors_5m: 0, ingest_sessions_5m: 0,
  apps_active: 0, alerts_unacked: 0, deliveries_queued: 0, deliveries_failed: 0,
  deliveries_dead: 0, metering_lag_hours: null,
};

/** Instantané de santé interne (un seul aller-retour). */
export async function internalHealth(): Promise<HealthSnapshot> {
  try {
    const [r] = await q<HealthSnapshot>(
      `select
         (select count(*) from rum_metric   where ts > now() - interval '5 minutes')::int as ingest_metrics_5m,
         (select count(*) from rum_pageview where started_at > now() - interval '5 minutes')::int as ingest_pageviews_5m,
         (select count(*) from rum_error    where ts > now() - interval '5 minutes')::int as ingest_errors_5m,
         (select count(distinct session_id) from rum_pageview where started_at > now() - interval '5 minutes')::int as ingest_sessions_5m,
         (select count(*) from app_registry where active)::int as apps_active,
         (select count(*) from alert_event where not acknowledged)::int as alerts_unacked,
         (select count(*) from alert_delivery where status = 'queued')::int as deliveries_queued,
         (select count(*) from alert_delivery where status = 'failed')::int as deliveries_failed,
         (select count(*) from alert_delivery where status = 'dead')::int as deliveries_dead,
         (select extract(epoch from (now() - max(metered_at))) / 3600.0 from tenant_usage_daily)::float as metering_lag_hours`,
    );
    return r ?? ZERO;
  } catch {
    return ZERO;
  }
}
