import { fmtDate } from "@/lib/format";
import {
  ALERT_COMPARATORS,
  ALERT_METRICS,
  alertEvents,
  alertRules,
  filtersToQuery,
  parseFilters,
  registeredApps,
  unackedAlertCount,
  type AlertRuleRow,
  type SearchParams,
} from "@/lib/queries-v2";
import {
  ackEventAction,
  createRuleAction,
  evaluateNowAction,
  toggleRuleAction,
  updateRuleAction,
} from "./actions";

export const dynamic = "force-dynamic";

const INPUT_CLASS =
  "rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";

export default async function Alerts({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const f = parseFilters(sp);
  const [rules, events, unacked, apps] = await Promise.all([
    alertRules(f),
    alertEvents(f),
    unackedAlertCount(f),
    registeredApps(),
  ]);
  const firedRaw = Array.isArray(sp.fired) ? sp.fired[0] : sp.fired;
  const fired = firedRaw != null && /^\d+$/.test(firedRaw) ? Number(firedRaw) : null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Alertes</h1>
        {unacked > 0 && (
          <span
            data-testid="unacked-badge"
            className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white"
          >
            {unacked} non acquittée(s)
          </span>
        )}
        <form action={evaluateNowAction} className="ml-auto">
          <input type="hidden" name="qs" value={filtersToQuery(f)} />
          <button
            type="submit"
            data-testid="evaluate-now"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Évaluer maintenant
          </button>
        </form>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Règles évaluées sur fenêtre glissante (p75 des vitals, taux d&apos;erreur) — check_alerts(),
        planifiée par pg_cron en cloud · webhook optionnel
      </p>

      {fired != null && (
        <div
          data-testid="fired-banner"
          className={`mb-6 rounded-lg border px-4 py-3 text-sm font-medium ${
            fired > 0
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }`}
        >
          check_alerts() exécutée : {fired} alerte(s) déclenchée(s).
        </div>
      )}

      {/* ----- Création ----- */}
      <details className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm" open={!rules.length}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
          + Nouvelle règle
        </summary>
        <form action={createRuleAction} className="flex flex-wrap items-end gap-3 border-t border-slate-100 p-4">
          <RuleFields apps={apps} defaultApp={f.app !== "all" ? f.app : undefined} />
          <button
            type="submit"
            data-testid="create-rule"
            className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
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
          <p className="py-4 text-center text-sm text-slate-400">
            Aucune règle — crée la première ci-dessus.
          </p>
        )}
      </div>

      {/* ----- Flux d'événements ----- */}
      <h2 className="mb-3 text-lg font-bold">Événements déclenchés</h2>
      <div className="flex flex-col gap-2">
        {events.map((e) => (
          <div
            key={e.id}
            data-testid={`alert-event-${e.id}`}
            className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm shadow-sm ${
              e.acknowledged ? "border-slate-200 bg-white" : "border-red-300 bg-red-50"
            }`}
          >
            {!e.acknowledged && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                non acquittée
              </span>
            )}
            <span className="font-mono text-xs text-slate-400">#{e.id}</span>
            <span className="font-medium">{e.message ?? `${e.metric} (règle ${e.rule_id})`}</span>
            <span className="ml-auto text-xs text-slate-500">{fmtDate(e.fired_at)}</span>
            {e.acknowledged ? (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">acquittée</span>
            ) : (
              <form action={ackEventAction}>
                <input type="hidden" name="id" value={e.id} />
                <button
                  type="submit"
                  data-testid={`ack-${e.id}`}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium hover:bg-slate-100"
                >
                  Acquitter
                </button>
              </form>
            )}
          </div>
        ))}
        {!events.length && (
          <p className="py-4 text-center text-sm text-slate-400">
            Aucun événement — crée une règle puis « Évaluer maintenant ».
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
    </>
  );
}

function RuleRow({ rule, apps }: { rule: AlertRuleRow; apps: { app_id: string; name: string }[] }) {
  return (
    <form
      action={updateRuleAction}
      data-testid={`rule-${rule.id}`}
      className={`flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 shadow-sm ${
        rule.active ? "border-slate-200" : "border-slate-200 opacity-60"
      }`}
    >
      <input type="hidden" name="id" value={rule.id} />
      <span className="self-center font-mono text-xs text-slate-400">#{rule.id}</span>
      <RuleFields apps={apps} rule={rule} />
      {rule.unacked > 0 && (
        <span className="self-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
          {rule.unacked} alerte(s) en cours
        </span>
      )}
      <span
        className={`self-center rounded px-2 py-0.5 text-xs font-medium ${
          rule.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
        }`}
      >
        {rule.active ? "active" : "désactivée"}
      </span>
      <div className="ml-auto flex gap-2">
        <button
          type="submit"
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
        >
          Enregistrer
        </button>
        <button
          type="submit"
          formAction={toggleRuleAction}
          data-testid={`toggle-${rule.id}`}
          className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
            rule.active ? "bg-slate-500 hover:bg-slate-600" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {rule.active ? "Désactiver" : "Activer"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
      {label}
      {children}
    </label>
  );
}
