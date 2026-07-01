import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import {
  alertEvents,
  alertRules,
  filtersToQuery,
  parseFilters,
  unackedAlertCount,
  type SearchParams,
} from "@/lib/queries-v2";
import { registeredApps } from "@/lib/queries";
import { listChannels } from "@/lib/queries-alerting";
import { SeverityBadge } from "@/components/alerts/SeverityBadge";
import { RuleFields } from "@/components/alerts/RuleFields";
import { RuleRow } from "@/components/alerts/RuleRow";
import { ChannelsSection } from "@/components/alerts/ChannelsSection";
import {
  ackEventAction,
  createRuleAction,
  evaluateNowAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function Alerts({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const f = parseFilters(sp);
  const [rules, events, unacked, apps, channels] = await Promise.all([
    alertRules(f),
    alertEvents(f),
    unackedAlertCount(f),
    registeredApps(),
    listChannels(f.app),
  ]);
  const firedRaw = Array.isArray(sp.fired) ? sp.fired[0] : sp.fired;
  const fired = firedRaw != null && /^\d+$/.test(firedRaw) ? Number(firedRaw) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Alertes
            {unacked > 0 && (
              <span
                data-testid="unacked-badge"
                className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white"
              >
                {unacked} non acquittée(s)
              </span>
            )}
          </span>
        }
        sub={
          <>
            Règles évaluées sur fenêtre glissante (p75 des vitals, taux d&apos;erreur) — check_alerts(),
            planifiée par pg_cron en cloud · webhook optionnel
          </>
        }
      >
        <form action={evaluateNowAction}>
          <input type="hidden" name="qs" value={filtersToQuery(f)} />
          <button type="submit" data-testid="evaluate-now" className="btn-accent">
            Évaluer maintenant
          </button>
        </form>
      </PageHeader>

      {fired != null && (
        <div
          data-testid="fired-banner"
          className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${
            fired > 0
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
          }`}
        >
          check_alerts() exécutée : {fired} alerte(s) déclenchée(s).
        </div>
      )}

      {/* ----- Création ----- */}
      <details className="card mb-6" open={!rules.length}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          + Nouvelle règle
        </summary>
        <form action={createRuleAction} className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          <RuleFields apps={apps} defaultApp={f.app !== "all" ? f.app : undefined} />
          <button type="submit" data-testid="create-rule" className="btn-accent">
            Créer
          </button>
        </form>
      </details>

      {/* ----- Règles ----- */}
      <div className="mb-8 flex flex-col gap-3">
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} apps={apps} />
        ))}
        {!rules.length && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Aucune règle — crée la première ci-dessus.
          </p>
        )}
      </div>

      {/* ----- Flux d'événements ----- */}
      <h2 className="mb-3 text-base font-bold tracking-tight">Événements déclenchés</h2>
      <div className="flex flex-col gap-2">
        {events.map((e) => (
          <div
            key={e.id}
            data-testid={`alert-event-${e.id}`}
            className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm shadow-card ${
              e.acknowledged
                ? "border-line bg-panel"
                : "border-red-300 bg-red-50 dark:border-red-400/30 dark:bg-red-400/10"
            }`}
          >
            {!e.acknowledged && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                non acquittée
              </span>
            )}
            <span className="font-mono text-xs text-ink-faint">#{e.id}</span>
            <SeverityBadge severity={e.severity} />
            <span className="font-medium">
              {e.message ?? `${e.metric} (${e.rule_id != null ? `règle ${e.rule_id}` : "SLO"})`}
            </span>
            <span className="ml-auto text-xs tabular-nums text-ink-soft">{fmtDate(e.fired_at)}</span>
            {e.acknowledged ? (
              <span className="rounded bg-panel2 px-2 py-0.5 text-xs text-ink-faint">acquittée</span>
            ) : (
              <form action={ackEventAction}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" data-testid={`ack-${e.id}`} className="btn-ghost">
                  Acquitter
                </button>
              </form>
            )}
          </div>
        ))}
        {!events.length && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Aucun événement — crée une règle puis « Évaluer maintenant ».
          </p>
        )}
      </div>

      {/* ----- Canaux de notification ----- */}
      <ChannelsSection channels={channels} apps={apps} defaultApp={f.app !== "all" ? f.app : undefined} />
    </div>
  );
}
