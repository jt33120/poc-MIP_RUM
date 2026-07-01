// Ligne de règle d'alerte : formulaire d'édition inline + activer/désactiver.
import { type AlertRuleRow } from "@/lib/queries-v2";
import { toggleRuleAction, updateRuleAction } from "@/app/alerts/actions";
import { RuleFields } from "./RuleFields";

export function RuleRow({ rule, apps }: { rule: AlertRuleRow; apps: { app_id: string; name: string }[] }) {
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
