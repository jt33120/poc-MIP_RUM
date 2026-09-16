// Champs partagés création/édition d'une règle d'alerte — formulaires HTML purs.
import { ALERT_MODES, ALERT_SEVERITIES } from "@/lib/alerting";
import { ALERT_COMPARATORS, ALERT_METRICS, metricLabel, type AlertRuleRow } from "@/lib/queries-v2";
import { Field, INPUT_CLASS } from "@/components/forms/Field";

/** Champs partagés création/édition (composant serveur, formulaires HTML purs). */
export function RuleFields({
  apps,
  rule,
  defaultApp,
}: {
  apps: { app_id: string; name: string }[];
  rule?: AlertRuleRow;
  defaultApp?: string;
}) {
  const selectedMetric = rule?.metric.startsWith("event:") ? "event" : (rule?.metric ?? "LCP");
  const eventName = rule?.metric.startsWith("event:") ? rule.metric.slice(6) : "";
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
        <select name="metric" defaultValue={selectedMetric} className={INPUT_CLASS}>
          {ALERT_METRICS.map((m) => (
            <option key={m} value={m}>
              {metricLabel(m)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nom d’événement">
        <input
          name="event_name"
          defaultValue={eventName}
          maxLength={100}
          placeholder="checkout (si métrique événement)"
          className={`${INPUT_CLASS} w-48`}
        />
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
        (seuil = mode &laquo;&nbsp;threshold&nbsp;&raquo; ; sensibilité = mode &laquo;&nbsp;baseline&nbsp;&raquo;).{" "}
        <strong>Logs ERROR</strong> et <strong>Événement custom</strong> se cumulent sur la fenêtre —
        les heures inactives valent zéro pour la baseline.
      </p>
    </>
  );
}
