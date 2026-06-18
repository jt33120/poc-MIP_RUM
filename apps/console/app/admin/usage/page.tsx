import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { monthlyUsage } from "@/lib/queries-usage";
import { quotaView } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Consommation par client (mois courant) + quotas — admin only (P0 #5). */
export default async function Usage() {
  await requireAdmin();
  const rows = await monthlyUsage();
  const month = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="animate-fade-up">
      <PageHeader title="Consommation & quotas" sub={`Usage du mois — ${month}`} />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Client</th>
              <th className="th text-right">Events</th>
              <th className="th text-right">Sessions</th>
              <th className="th text-right">Erreurs</th>
              <th className="th">Quota mensuel</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const qv = quotaView(r.events, r.quota);
              return (
                <tr key={r.app_id} className="border-t border-line/60">
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="ml-2 chip-mono text-xs">{r.app_id}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" data-testid="usage-events">
                    {r.events.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {r.sessions.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {r.errors.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-2">
                    {r.quota == null ? (
                      <span className="text-xs text-ink-faint">illimité</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
                          <div
                            className={`h-full ${qv.over ? "bg-red-500" : "bg-accent"}`}
                            style={{ width: `${Math.min(100, qv.pct ?? 0)}%` }}
                          />
                        </div>
                        <span className={`text-xs ${qv.over ? "font-semibold text-red-600 dark:text-red-400" : "text-ink-faint"}`}>
                          {qv.label} de {r.quota.toLocaleString("fr-FR")}
                          {qv.over && " · dépassé"}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  Aucune donnée d'usage (le métering tourne une fois par jour).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Métering agrégé quotidiennement (`meter_tenant_usage`), durable (conservé au-delà de la
        rétention de télémétrie). Quota par client : `app_registry.monthly_quota`.
      </p>
    </div>
  );
}
