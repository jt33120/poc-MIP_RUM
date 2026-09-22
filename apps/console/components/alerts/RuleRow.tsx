// Ligne de règle d'alerte : formulaire d'édition inline + activer/désactiver.
import { fmtDate } from "@/lib/format";
import { type AlertRuleRow, type RuleState } from "@/lib/queries-v2";
import { toggleRuleAction, updateRuleAction } from "@/app/alerts/actions";
import { RuleFields } from "./RuleFields";

const ETATS: Record<RuleState, { label: string; cls: string }> = {
  ok: { label: "Normale", cls: "bg-panel2 text-ink-soft" },
  breached: {
    label: "Franchie",
    cls: "bg-bad/10 text-bad-ink",
  },
  no_data: {
    label: "Données insuffisantes",
    cls: "border border-warn/30 bg-warn/10 text-warn-ink",
  },
};

/** Dernière évaluation : no_data dit pourquoi, au lieu de passer pour une valeur normale. */
function RuleEvaluation({ rule }: { rule: AlertRuleRow }) {
  if (!rule.last_state || !rule.last_evaluated_at) return null;
  const etat = ETATS[rule.last_state];
  return (
    <span data-testid={`rule-state-${rule.id}`} className={`self-center rounded px-2 py-0.5 text-xs font-medium ${etat.cls}`}>
      {etat.label}
      {rule.last_state === "no_data" && rule.last_reason ? ` — ${rule.last_reason}` : ""}
      {rule.last_state !== "no_data" && rule.last_value !== null ? ` (${rule.last_value.toLocaleString("fr-FR")})` : ""}
      <span className="ml-1 text-ink-faint">· évaluée {fmtDate(rule.last_evaluated_at)}</span>
    </span>
  );
}

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
      <RuleEvaluation rule={rule} />
      {rule.unacked > 0 && (
        <span className="self-center rounded-full bg-bad/10 px-2 py-0.5 text-xs font-bold text-bad-ink">
          {rule.unacked} alerte(s) en cours
        </span>
      )}
      <span
        className={`self-center rounded px-2 py-0.5 text-xs font-medium ${
          rule.active
            ? "bg-good/10 text-good-ink"
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
            rule.active ? "bg-slate-500 hover:bg-slate-600" : "bg-good hover:bg-good/90"
          }`}
        >
          {rule.active ? "Désactiver" : "Activer"}
        </button>
      </div>
    </form>
  );
}
