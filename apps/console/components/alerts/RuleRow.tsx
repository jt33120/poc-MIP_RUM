// Ligne de règle d'alerte (F64, plan § 5.19 A7) : son ÉTAT d'abord, son édition
// ensuite, et seulement pour un administrateur (V9 : aucun bouton d'écriture n'est
// RENDU pour un viewer ou une session de démonstration).
//
// CE QU'ELLE ÉCRIT, ET QUE L'ANCIENNE LIGNE LAISSAIT DEVINER. La règle était
// lisible uniquement à travers les valeurs de son formulaire d'édition : treize
// champs, dont plusieurs sans effet selon le mode. La ligne dit maintenant en
// toutes lettres ce que la règle surveille (métrique, route, env), comment elle se
// déclenche (mode, seuil ou sensibilité, fenêtre), et ce que la dernière évaluation
// a trouvé — `no_data` avec sa raison, jamais confondu avec « normale ».
import { fmtDate } from "@/lib/format";
import { libelleDeRegle, reglageDeRegle } from "@/lib/alertes-ecran";
import { type AlertRuleRow, type RuleState } from "@/lib/queries-v2";
import { toggleRuleAction, updateRuleAction } from "@/app/alerts/actions";
import { RuleFields, type ModeRelease } from "./RuleFields";

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
  if (!rule.last_state || !rule.last_evaluated_at) {
    return (
      <span data-testid={`rule-state-${rule.id}`} className="self-center rounded bg-panel2 px-2 py-0.5 text-xs text-ink-soft">
        Jamais évaluée
      </span>
    );
  }
  const etat = ETATS[rule.last_state] ?? { label: rule.last_state, cls: "bg-panel2 text-ink-soft" };
  return (
    <span
      data-testid={`rule-state-${rule.id}`}
      data-etat={rule.last_state}
      className={`self-center rounded px-2 py-0.5 text-xs font-medium ${etat.cls}`}
    >
      {etat.label}
      {rule.last_state === "no_data" && rule.last_reason ? ` — ${rule.last_reason}` : ""}
      {/* Une règle de release dit CE QU'ELLE A COMPARÉ (v86 : releases, p75, effectifs,
          écart) ; une valeur seule ne dirait pas contre quelle release. */}
      {rule.last_state !== "no_data" && rule.mode === "release" && rule.last_reason ? ` — ${rule.last_reason}` : ""}
      {rule.last_state !== "no_data" && !(rule.mode === "release" && rule.last_reason) && rule.last_value !== null
        ? ` (${rule.last_value.toLocaleString("fr-FR")})`
        : ""}
      <span className="ml-1 text-ink-faint">· évaluée {fmtDate(rule.last_evaluated_at)}</span>
    </span>
  );
}

export function RuleRow({
  rule,
  apps,
  admin = false,
  modeRelease,
}: {
  rule: AlertRuleRow;
  apps: { app_id: string; name: string }[];
  /** V9 : sans droit d'écriture, ni formulaire ni bouton dans le DOM. */
  admin?: boolean;
  /** F68 : l'option « Régression de release » du formulaire d'édition (B52). */
  modeRelease?: ModeRelease;
}) {
  return (
    <div
      id={`regle-${rule.id}`}
      data-testid={`rule-${rule.id}`}
      className={`card min-w-0 p-4 ${rule.active ? "" : "opacity-60"}`}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span className="shrink-0 font-mono text-xs text-ink-faint">#{rule.id}</span>
        <span className="min-w-0 break-words text-sm font-semibold text-ink">{libelleDeRegle(rule)}</span>
        <RuleEvaluation rule={rule} />
        {rule.unacked > 0 && (
          <span className="shrink-0 rounded-full bg-bad/10 px-2 py-0.5 text-xs font-bold text-bad-ink">
            {rule.unacked} non acquittée(s)
          </span>
        )}
        <span
          className={`ml-auto shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
            rule.active ? "bg-good/10 text-good-ink" : "bg-panel2 text-ink-faint"
          }`}
        >
          {rule.active ? "active" : "désactivée"}
        </span>
      </div>
      <p className="mt-1 min-w-0 break-words text-xs text-ink-soft" data-testid={`rule-reglage-${rule.id}`}>
        {reglageDeRegle(rule)} · app {rule.app_id}
      </p>

      {admin && (
        <details className="mt-2 min-w-0">
          <summary className="cursor-pointer select-none text-xs font-medium text-ink-soft transition hover:text-ink">
            Modifier cette règle
          </summary>
          <form action={updateRuleAction} className="mt-3 flex min-w-0 flex-wrap items-end gap-3 border-t border-line pt-3">
            <input type="hidden" name="id" value={rule.id} />
            {/* L'application ACTUELLE de la règle : la commande la cherche là (C8) ; `app_id` peut la déplacer. */}
            <input type="hidden" name="app" value={rule.app_id} />
            {/* L'état VOULU par le bouton « Activer / Désactiver » (C8) : un champ du formulaire,
                pas la valeur du bouton, que l'action d'un `formAction` ne reçoit pas. */}
            <input type="hidden" name="active" value={rule.active ? "false" : "true"} />
            <RuleFields apps={apps} rule={rule} modeRelease={modeRelease} />
            <div className="ml-auto flex shrink-0 gap-2">
              <button type="submit" className="btn-ghost">
                Enregistrer
              </button>
              <button
                type="submit"
                formAction={toggleRuleAction}
                data-testid={`toggle-${rule.id}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition ${
                  rule.active ? "bg-slate-500 hover:bg-slate-600" : "bg-good-fond hover:bg-good-fond/90"
                }`}
              >
                {rule.active ? "Désactiver" : "Activer"}
              </button>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
