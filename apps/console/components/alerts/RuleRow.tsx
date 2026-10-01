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
//
// UNE LIGNE PAR RÈGLE (recette du 30/09/2026). Une carte de trois lignes par règle
// faisait défiler l'écran pour quatre règles : la ligne porte une pastille d'état,
// la règle, son réglage (coupé, entier au survol), la dernière évaluation, le dernier
// déclenchement et ses déclenchements des trente jours en micro-barres.
import { fmtDate, accord } from "@/lib/format";
import { formater } from "@/lib/fmt-ids";
import { libelleDeRegle, reglageDeRegle, valeurDeMetrique } from "@/lib/alertes-ecran";
import { type AlertRuleRow, type RuleState } from "@/lib/queries-v2";
import { toggleRuleAction, updateRuleAction } from "@/app/alerts/actions";
import { RuleFields, type ModeRelease } from "./RuleFields";

const ETATS: Record<RuleState, { label: string; cls: string; point: string }> = {
  ok: { label: "Normale", cls: "bg-panel2 text-ink-soft", point: "bg-good" },
  breached: {
    label: "Franchie",
    cls: "bg-bad/10 text-bad-ink",
    point: "bg-bad",
  },
  no_data: {
    label: "Données insuffisantes",
    cls: "border border-warn/30 bg-warn/10 text-warn-ink",
    point: "bg-warn",
  },
  // v105 : la collecte était coupée sur la fenêtre ; ni « normale » ni « sans
  // données » — rien n'a pu arriver, la raison dit quelle coupure.
  hors_collecte: {
    label: "Hors collecte",
    cls: "border border-dashed border-line bg-panel2 text-ink-soft",
    point: "border border-ink-faint bg-transparent",
  },
};

/** États sans verdict : leur raison est écrite, jamais une valeur. */
const SANS_VERDICT: ReadonlySet<string> = new Set(["no_data", "hors_collecte"]);

/** La pastille d'une règle : la couleur de son dernier état, creuse si elle n'a jamais été évaluée. */
function pointDe(rule: AlertRuleRow): string {
  if (!rule.active) return "bg-ink-faint/40";
  if (!rule.last_state || !rule.last_evaluated_at) return "border border-ink-faint bg-transparent";
  return ETATS[rule.last_state]?.point ?? "bg-ink-faint/40";
}

/** Dernière évaluation : no_data et hors_collecte disent pourquoi, au lieu de passer pour une valeur normale. */
function RuleEvaluation({ rule }: { rule: AlertRuleRow }) {
  if (!rule.last_state || !rule.last_evaluated_at) {
    return (
      <span data-testid={`rule-state-${rule.id}`} className="shrink-0 rounded bg-panel2 px-2 py-0.5 text-[11px] text-ink-soft">
        Jamais évaluée
      </span>
    );
  }
  const etat = ETATS[rule.last_state] ?? { label: rule.last_state, cls: "bg-panel2 text-ink-soft" };
  // Une règle de release dit CE QU'ELLE A COMPARÉ (v86 : releases, p75, effectifs,
  // écart) ; une valeur seule ne dirait pas contre quelle release.
  const raison =
    (SANS_VERDICT.has(rule.last_state) || rule.mode === "release") && rule.last_reason ? rule.last_reason : null;
  const valeur = !raison && !SANS_VERDICT.has(rule.last_state) && rule.last_value !== null ? valeurDeMetrique(rule.metric, rule.last_value) : null;
  const complet = `${etat.label}${raison ? ` — ${raison}` : ""}${valeur ? ` (${valeur})` : ""} · évaluée ${fmtDate(rule.last_evaluated_at)}`;
  return (
    // Une ligne : l'état et sa valeur ; une raison longue se coupe, entière au survol.
    <span
      data-testid={`rule-state-${rule.id}`}
      data-etat={rule.last_state}
      title={complet}
      className={`inline-flex min-w-0 max-w-full items-baseline gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${etat.cls}`}
    >
      <span className="shrink-0">{etat.label}</span>
      {raison && <span className="min-w-0 truncate font-normal"> — {raison}</span>}
      {valeur && <span className="shrink-0 tabular-nums"> ({valeur})</span>}
      <span className="shrink-0 font-normal text-ink-faint"> · évaluée {fmtDate(rule.last_evaluated_at)}</span>
    </span>
  );
}

/**
 * Les déclenchements des trente jours, un trait par jour (du plus ancien au plus
 * récent) : la forme d'un coup d'œil, le compte exact pour un lecteur d'écran. Un
 * compte n'a pas de seuil : les traits restent neutres.
 */
function MicroBarres({ parJour }: { parJour: readonly number[] }) {
  const max = Math.max(1, ...parJour);
  const total = parJour.reduce((s, n) => s + n, 0);
  const l = 2;
  const pas = 3;
  const h = 14;
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="regle-trente-jours">
      <svg aria-hidden viewBox={`0 0 ${parJour.length * pas} ${h}`} className="h-3.5 w-[5.6rem] shrink-0">
        <line x1="0" x2={parJour.length * pas} y1={h - 0.5} y2={h - 0.5} className="stroke-line" strokeWidth="1" />
        {parJour.map((n, i) =>
          n > 0 ? (
            <rect key={i} x={i * pas} y={h - 1 - (n / max) * (h - 2)} width={l} height={(n / max) * (h - 2)} className="fill-ink-soft" />
          ) : null,
        )}
      </svg>
      <span className="w-6 shrink-0 text-right tabular-nums text-ink-soft">{formater("count", total)}</span>
      <span className="sr-only">déclenchement{total > 1 ? "s" : ""} sur {parJour.length} jours</span>
    </span>
  );
}

export function RuleRow({
  rule,
  apps,
  admin = false,
  modeRelease,
  dernierDeclenchement,
  parJour,
  avecApp = true,
}: {
  rule: AlertRuleRow;
  apps: { app_id: string; name: string }[];
  /** V9 : sans droit d'écriture, ni formulaire ni bouton dans le DOM. */
  admin?: boolean;
  /** F68 : l'option « Régression de release » du formulaire d'édition (B52). */
  modeRelease?: ModeRelease;
  /** Instant du dernier déclenchement de la règle sur la frise des trente jours ; `null` : aucun. */
  dernierDeclenchement?: Date | string | null;
  /** Déclenchements par jour sur la même fenêtre, du plus ancien au plus récent. */
  parJour?: readonly number[];
  /** Plusieurs apps à l'écran : le réglage nomme l'app ; une seule, il ne la répète pas. */
  avecApp?: boolean;
}) {
  const reglage = `${reglageDeRegle(rule)}${avecApp ? ` · app ${rule.app_id}` : ""}`;
  // La ligne, en éléments de texte (`span`) : pour un administrateur, elle EST le résumé
  // du repli d'édition — un clic sur la règle ouvre son formulaire, comme un clic sur une
  // ligne ouvre son détail ailleurs dans la console.
  const ligne = (
    <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-xs lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)_auto]">
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${pointDe(rule)}`} />
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink" title={libelleDeRegle(rule)}>
          {libelleDeRegle(rule)}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">#{rule.id}</span>
      </span>
      {/* Le réglage en une ligne ; entier au survol et pour les lecteurs d'écran. */}
      <span
        className="order-last col-span-2 block min-w-0 truncate text-ink-soft lg:order-none lg:col-span-1"
        data-testid={`rule-reglage-${rule.id}`}
        title={reglage}
      >
        {reglage}
      </span>
      <span className="order-last col-span-2 flex min-w-0 lg:order-none lg:col-span-1">
        <RuleEvaluation rule={rule} />
      </span>
      <span className="flex shrink-0 items-center justify-end gap-2 text-[11px] text-ink-soft">
        {rule.unacked > 0 && (
          <span className="shrink-0 rounded-full bg-bad/10 px-2 py-0.5 font-bold text-bad-ink">
            {rule.unacked} non {accord(rule.unacked, "acquittée", "acquittées")}
          </span>
        )}
        {dernierDeclenchement !== undefined && (
          <span className="hidden shrink-0 tabular-nums sm:inline" data-testid={`rule-dernier-${rule.id}`}>
            {dernierDeclenchement ? `dernière le ${fmtDate(dernierDeclenchement)}` : "aucune sur 30 j"}
          </span>
        )}
        {parJour && parJour.length > 0 && <MicroBarres parJour={parJour} />}
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${rule.active ? "bg-good/10 text-good-ink" : "bg-panel2 text-ink-faint"}`}>
          {rule.active ? "active" : "désactivée"}
        </span>
        {admin && (
          <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-medium text-ink-soft group-open/regle:bg-panel2">
            Modifier<span className="sr-only"> cette règle</span>
          </span>
        )}
      </span>
    </span>
  );
  return (
    <div id={`regle-${rule.id}`} data-testid={`rule-${rule.id}`} className={`min-w-0 scroll-mt-20 ${rule.active ? "" : "opacity-60"}`}>
      {!admin ? (
        ligne
      ) : (
        <details className="group/regle min-w-0">
          <summary className="cursor-pointer list-none transition hover:bg-panel2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf [&::-webkit-details-marker]:hidden">
            {ligne}
          </summary>
          <form action={updateRuleAction} className="mx-3 mb-3 flex min-w-0 flex-wrap items-end gap-3 border-t border-line pt-3">
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
