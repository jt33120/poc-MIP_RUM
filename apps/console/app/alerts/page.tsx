import { PageHeader } from "@/components/PageHeader";
import { ALERT_MODES, ALERT_SEVERITIES, CHANNEL_KINDS } from "@/lib/alerting";
import { fmtDate } from "@/lib/format";
import {
  ALERT_COMPARATORS,
  ALERT_METRICS,
  alertEvents,
  alertRules,
  filtersToQuery,
  parseFilters,
  unackedAlertCount,
  type AlertRuleRow,
  type SearchParams,
} from "@/lib/queries-v2";
import { registeredApps } from "@/lib/queries";
import { listChannels } from "@/lib/queries-alerting";
import { Field, INPUT_CLASS } from "@/components/forms/Field";
import {
  ackEventAction,
  createChannelAction,
  createRuleAction,
  deleteChannelAction,
  evaluateNowAction,
  toggleChannelAction,
  toggleRuleAction,
  updateRuleAction,
} from "./actions";

/** Classes Tailwind d'un badge de sévérité (critical=rouge, warning=ambre, info=slate). */
const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  info: "bg-slate-100 text-slate-700 dark:bg-slate-400/10 dark:text-slate-300",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.info}`}
    >
      {severity}
    </span>
  );
}

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

/** Section routing : liste des canaux + création (webhook/slack/email), filtrés par sévérité. */
function ChannelsSection({
  channels,
  apps,
  defaultApp,
}: {
  channels: { id: number; app_id: string | null; kind: string; target: string; severity_min: string; active: boolean }[];
  apps: { app_id: string; name: string }[];
  defaultApp?: string;
}) {
  return (
    <div className="mt-10">
      <h2 className="mb-1 text-base font-bold tracking-tight">Canaux de notification</h2>
      <p className="mb-3 text-sm text-ink-soft">
        Routent les alertes (en plus du webhook de la règle) vers N destinations, filtrées par
        sévérité minimale. App vide = global (tous les tenants). E-mail réservé (non livré).
      </p>

      <details className="card mb-6" open={!channels.length}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          + Nouveau canal
        </summary>
        <form
          action={createChannelAction}
          className="flex flex-wrap items-end gap-3 border-t border-line p-4"
        >
          <Field label="App (optionnel)">
            <select name="app_id" defaultValue={defaultApp ?? ""} className={INPUT_CLASS}>
              <option value="">tous (global)</option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.app_id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select name="kind" defaultValue="webhook" className={INPUT_CLASS}>
              {CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cible">
            <input
              name="target"
              required
              placeholder="https://hooks.slack.com/…"
              className={`${INPUT_CLASS} w-72 font-mono`}
            />
          </Field>
          <Field label="Sévérité min">
            <select name="severity_min" defaultValue="warning" className={INPUT_CLASS}>
              {ALERT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" data-testid="create-channel" className="btn-accent">
            Créer
          </button>
        </form>
      </details>

      <div className="flex flex-col gap-3">
        {channels.map((c) => (
          <div
            key={c.id}
            data-testid={`channel-${c.id}`}
            className={`card flex flex-wrap items-center gap-3 p-4 ${c.active ? "" : "opacity-60"}`}
          >
            <span className="font-mono text-xs text-ink-faint">#{c.id}</span>
            <span className="rounded bg-panel2 px-2 py-0.5 text-xs font-medium text-ink-soft">
              {c.kind}
            </span>
            <span className="truncate font-mono text-sm">{c.target}</span>
            <span className="text-xs text-ink-faint">
              {c.app_id ?? "global"} · ≥ <SeverityBadge severity={c.severity_min} />
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                c.active
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "bg-panel2 text-ink-faint"
              }`}
            >
              {c.active ? "actif" : "désactivé"}
            </span>
            <div className="ml-auto flex gap-2">
              <form action={toggleChannelAction}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  data-testid={`toggle-channel-${c.id}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition ${
                    c.active ? "bg-slate-500 hover:bg-slate-600" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {c.active ? "Désactiver" : "Activer"}
                </button>
              </form>
              <form action={deleteChannelAction}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  data-testid={`delete-channel-${c.id}`}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
                >
                  Supprimer
                </button>
              </form>
            </div>
          </div>
        ))}
        {!channels.length && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Aucun canal — ajoute-en un ci-dessus pour router les alertes.
          </p>
        )}
      </div>
    </div>
  );
}

/** Champs partagés création/édition (composant serveur, formulaires HTML purs). */
function RuleFields({
  apps,
  rule,
  defaultApp,
}: {
  apps: { app_id: string; name: string }[];
  rule?: AlertRuleRow;
  defaultApp?: string;
}) {
  return (
    <>
      <Field label="App">
        <select name="app_id" defaultValue={rule?.app_id ?? defaultApp ?? apps[0]?.app_id} className={INPUT_CLASS}>
          {apps.map((a) => (
            <option key={a.app_id} value={a.app_id}>
              {a.app_id}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Métrique">
        <select name="metric" defaultValue={rule?.metric ?? "LCP"} className={INPUT_CLASS}>
          {ALERT_METRICS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Mode">
        <select name="mode" defaultValue={rule?.mode ?? "threshold"} className={INPUT_CLASS}>
          {ALERT_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sévérité">
        <select name="severity" defaultValue={rule?.severity ?? "warning"} className={INPUT_CLASS}>
          {ALERT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Route (optionnel)">
        <input
          name="route"
          defaultValue={rule?.route ?? ""}
          placeholder="/login (vide = toutes)"
          className={`${INPUT_CLASS} w-40 font-mono`}
        />
      </Field>
      <Field label="Comparateur">
        <select name="comparator" defaultValue={rule?.comparator ?? ">"} className={INPUT_CLASS}>
          {ALERT_COMPARATORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Seuil">
        <input
          name="threshold"
          type="number"
          step="any"
          required
          defaultValue={rule?.threshold}
          className={`${INPUT_CLASS} w-24`}
        />
      </Field>
      <Field label="Sensibilité">
        <input
          name="sensitivity"
          type="number"
          step="0.5"
          min={0.5}
          defaultValue={rule?.sensitivity ?? 3}
          className={`${INPUT_CLASS} w-20`}
        />
      </Field>
      <Field label="Semaines baseline">
        <input
          name="baseline_weeks"
          type="number"
          min={1}
          max={12}
          defaultValue={rule?.baseline_weeks ?? 4}
          className={`${INPUT_CLASS} w-20`}
        />
      </Field>
      <Field label="Fenêtre (min)">
        <input
          name="window_minutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={rule?.window_minutes ?? 15}
          className={`${INPUT_CLASS} w-20`}
        />
      </Field>
      <Field label="Webhook (optionnel)">
        <input
          name="webhook_url"
          type="url"
          defaultValue={rule?.webhook_url ?? ""}
          placeholder="https://…"
          className={`${INPUT_CLASS} w-48`}
        />
      </Field>
      <p className="w-full text-xs text-ink-faint">
        (seuil = mode &laquo;&nbsp;threshold&nbsp;&raquo; ; sensibilité = mode &laquo;&nbsp;baseline&nbsp;&raquo;)
      </p>
    </>
  );
}

function RuleRow({ rule, apps }: { rule: AlertRuleRow; apps: { app_id: string; name: string }[] }) {
  return (
    <form
      action={updateRuleAction}
      data-testid={`rule-${rule.id}`}
      className={`card flex flex-wrap items-end gap-3 p-4 ${rule.active ? "" : "opacity-60"}`}
    >
      <input type="hidden" name="id" value={rule.id} />
      <span className="self-center font-mono text-xs text-ink-faint">#{rule.id}</span>
      <RuleFields apps={apps} rule={rule} />
      {rule.unacked > 0 && (
        <span className="self-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 dark:bg-red-400/10 dark:text-red-300">
          {rule.unacked} alerte(s) en cours
        </span>
      )}
      <span
        className={`self-center rounded px-2 py-0.5 text-xs font-medium ${
          rule.active
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"
            : "bg-panel2 text-ink-faint"
        }`}
      >
        {rule.active ? "active" : "désactivée"}
      </span>
      <div className="ml-auto flex gap-2">
        <button type="submit" className="btn-ghost">
          Enregistrer
        </button>
        <button
          type="submit"
          formAction={toggleRuleAction}
          data-testid={`toggle-${rule.id}`}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition ${
            rule.active ? "bg-slate-500 hover:bg-slate-600" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {rule.active ? "Désactiver" : "Activer"}
        </button>
      </div>
    </form>
  );
}
