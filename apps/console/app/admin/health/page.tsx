import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { internalHealth } from "@/lib/queries-health";

export const dynamic = "force-dynamic";

/** Santé interne de MIP RUM (auto-observabilité, P1) — admin. Mêmes chiffres que /api/metrics. */
export default async function Health() {
  await requireAdmin();
  const h = await internalHealth();

  const lag = h.metering_lag_hours;
  const lagTone = lag == null ? "" : lag > 30 ? "text-red-600 dark:text-red-400" : lag > 26 ? "text-amber-600 dark:text-amber-400" : "";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Santé interne"
        sub={
          <>
            Auto-observabilité de MIP RUM — ingestion, alertes, métering. Mêmes indicateurs exposés au
            format Prometheus sur <code>/api/metrics</code> (token requis).
          </>
        }
      />

      <h2 className="mb-2 text-sm font-semibold text-ink">Ingestion (5 min glissantes)</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Events (vitals)" value={h.ingest_metrics_5m} />
        <Stat label="Pages vues" value={h.ingest_pageviews_5m} />
        <Stat label="Erreurs" value={h.ingest_errors_5m} />
        <Stat label="Sessions" value={h.ingest_sessions_5m} />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Alertes & livraison</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Alertes non acquittées" value={h.alerts_unacked} tone={h.alerts_unacked > 0 ? "text-amber-600 dark:text-amber-400" : ""} />
        <Stat label="Livraisons en file" value={h.deliveries_queued} />
        <Stat label="Livraisons échouées" value={h.deliveries_failed} tone={h.deliveries_failed > 0 ? "text-amber-600 dark:text-amber-400" : ""} />
        <Stat label="Livraisons abandonnées" value={h.deliveries_dead} tone={h.deliveries_dead > 0 ? "text-red-600 dark:text-red-400" : ""} />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Tenants & métering</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Apps actives" value={h.apps_active} />
        <div className="card px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Retard métering</div>
          <div className={`mt-0.5 text-2xl font-bold tabular-nums ${lagTone}`}>
            {lag == null ? "—" : `${lag.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">dernier meter_tenant_usage</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${tone || "text-ink"}`}>
        {value.toLocaleString("fr-FR")}
      </div>
    </div>
  );
}
