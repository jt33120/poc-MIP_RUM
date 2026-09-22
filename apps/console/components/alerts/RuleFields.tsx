// Champs d'une règle d'alerte (F64, plan § 5.19 A8) — formulaires HTML purs, rendu
// serveur, partagés par la création et l'édition.
//
// POURQUOI UN FORMULAIRE PAR MODE. Les treize champs s'affichaient d'un coup, et
// plusieurs n'avaient aucun effet selon le mode : « Sensibilité » et « Semaines
// baseline » ne servent qu'au mode baseline, « Comparateur » et « Seuil » qu'au
// mode seuil. Un champ sans effet, rempli de bonne foi, est un mensonge d'interface.
// Désormais : un `<fieldset>` par mode, masqué par `:has(input:checked)` — pure CSS,
// aucun JavaScript. SANS support de `:has()`, aucune règle ne s'applique et les deux
// fieldsets restent visibles AVEC leur légende : le repli déclaré par le plan.
//
// « Régression de release » est présentée et DÉSACTIVÉE, avec sa raison : l'évaluateur
// `check_alerts` ne connaît pas ce mode (dépendance B52, § 6.3). Le seuil prévu (+20 %)
// est écrit, aligné sur `assessRegression` (`queries-deploys.ts`, ratio 1,2).
import { ALERT_MODES, ALERT_SEVERITIES } from "@/lib/alerting";
import { ALERT_COMPARATORS, ALERT_METRICS, metricLabel, type AlertRuleRow } from "@/lib/queries-v2";
import { Field, INPUT_CLASS } from "@/components/forms/Field";

/** Seuil par défaut de la régression de release (§ 3.2) : +20 %, comme `assessRegression`. */
export const SEUIL_REGRESSION_DEFAUT = 20;

export const RAISON_REGRESSION_RELEASE =
  "Mode indisponible : l'évaluateur check_alerts ne sait pas comparer deux releases (dépendance B52). Seuil prévu quand il le saura : +20 %, aligné sur le verdict de déploiement de /tracing.";

const MODES: { valeur: string; libelle: string; aide: string }[] = [
  { valeur: "threshold", libelle: "Seuil fixe", aide: "la valeur franchit une borne que vous posez" },
  { valeur: "baseline", libelle: "Écart à l'habitude (baseline)", aide: "la valeur s'écarte de ses semaines passées" },
];

/**
 * Champs partagés création/édition (composant serveur, formulaires HTML purs).
 * `defaultIssue` préremplit une alerte de pic depuis la page d'une issue ;
 * `regle` porte le pré-remplissage `regle_metrique` / `regle_route` / `regle_seuil`
 * de l'URL (§ 3.1), déjà validé par `lireEtatDeVue`.
 */
export function RuleFields({
  apps,
  rule,
  defaultApp,
  defaultIssue,
  regle,
}: {
  apps: { app_id: string; name: string }[];
  rule?: AlertRuleRow;
  defaultApp?: string;
  defaultIssue?: string;
  regle?: { metrique: string | null; route: string | null; seuil: number | null };
}) {
  const metriqueProposee = regle?.metrique ?? null;
  const familleProposee = metriqueProposee?.startsWith("event:")
    ? "event"
    : metriqueProposee?.startsWith("issue:")
      ? "issue"
      : metriqueProposee;
  const family = rule?.metric.startsWith("event:") ? "event" : rule?.metric.startsWith("issue:") ? "issue" : null;
  const selectedMetric = family ?? rule?.metric ?? familleProposee ?? (defaultIssue ? "issue" : "LCP");
  const eventName = family === "event" ? rule!.metric.slice(6) : (metriqueProposee?.startsWith("event:") ? metriqueProposee.slice(6) : "");
  const issueId =
    family === "issue"
      ? rule!.metric.slice(6)
      : (defaultIssue ?? (metriqueProposee?.startsWith("issue:") ? metriqueProposee.slice(6) : ""));
  const seuil = rule?.threshold ?? regle?.seuil ?? "";
  const route = rule?.route ?? regle?.route ?? "";
  const mode = rule?.mode && (ALERT_MODES as readonly string[]).includes(rule.mode) ? rule.mode : "threshold";

  return (
    <>
      {/* ── Ce qu'on surveille ── */}
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
        <select name="metric" defaultValue={selectedMetric} className={INPUT_CLASS} data-testid="champ-metrique">
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
      <Field label="Issue (identifiant)">
        <input
          name="issue_id"
          defaultValue={issueId}
          maxLength={36}
          placeholder="UUID (si métrique issue)"
          className={`${INPUT_CLASS} w-72 max-w-full font-mono`}
        />
      </Field>
      <Field label="Env (issue, optionnel)">
        <input
          name="env"
          defaultValue={rule?.env ?? ""}
          maxLength={120}
          placeholder="prod (vide = tous)"
          className={`${INPUT_CLASS} w-28`}
        />
      </Field>
      <Field label="Route (optionnel)">
        <input
          name="route"
          defaultValue={route}
          placeholder="/login (vide = toutes)"
          className={`${INPUT_CLASS} w-40 font-mono`}
          data-testid="champ-route"
        />
      </Field>

      {/* ── Comment elle se déclenche : un fieldset par mode ── */}
      <div className="regle-modes basis-full min-w-0">
        <fieldset className="min-w-0">
          <legend className="text-xs font-medium text-ink-soft">Mode de déclenchement</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
            {MODES.map((m) => (
              <label key={m.valeur} className="flex min-w-0 items-baseline gap-1.5 text-xs text-ink">
                <input
                  type="radio"
                  name="mode"
                  value={m.valeur}
                  defaultChecked={mode === m.valeur}
                  className={`regle-mode-${m.valeur === "threshold" ? "seuil" : "baseline"} shrink-0`}
                  data-testid={`mode-${m.valeur}`}
                />
                <span className="min-w-0">
                  <span className="font-medium">{m.libelle}</span>{" "}
                  <span className="text-ink-soft">— {m.aide}</span>
                </span>
              </label>
            ))}
            <label className="flex min-w-0 items-baseline gap-1.5 text-xs text-ink-faint" title={RAISON_REGRESSION_RELEASE}>
              <input type="radio" name="mode" value="release_regression" disabled className="shrink-0" data-testid="mode-release" />
              <span className="min-w-0">
                <span className="font-medium">Régression de release</span>{" "}
                <span>— indisponible ({SEUIL_REGRESSION_DEFAUT} % prévu, B52)</span>
              </span>
            </label>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint" data-testid="raison-release">
            {RAISON_REGRESSION_RELEASE}
          </p>

          <div className="regle-champs-seuil mt-3 flex flex-wrap items-end gap-3" data-testid="champs-seuil">
            <span className="basis-full text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Seuil fixe
            </span>
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
              {/* Sans `required` : en mode baseline ce champ est MASQUÉ, et un champ
                  requis masqué bloque l'envoi sans que rien ne soit visible. La
                  validation reste côté serveur (`ruleFromForm` refuse un seuil non
                  numérique en mode seuil). */}
              <input
                name="threshold"
                type="number"
                step="any"
                defaultValue={seuil}
                className={`${INPUT_CLASS} w-24`}
                data-testid="champ-seuil"
              />
            </Field>
          </div>

          <div className="regle-champs-baseline mt-3 flex flex-wrap items-end gap-3" data-testid="champs-baseline">
            <span className="basis-full text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Écart à l’habitude (baseline)
            </span>
            <Field label="Sensibilité">
              <input
                name="sensitivity"
                type="number"
                step="0.5"
                min={0.5}
                defaultValue={rule?.sensitivity ?? 3}
                className={`${INPUT_CLASS} w-20`}
                data-testid="champ-sensibilite"
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
                data-testid="champ-semaines"
              />
            </Field>
          </div>
        </fieldset>
      </div>

      {/* ── Ce que ça donne : fenêtre, sévérité, destinataire ── */}
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
      <Field label="Sévérité">
        <select name="severity" defaultValue={rule?.severity ?? "warning"} className={INPUT_CLASS}>
          {ALERT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
      <p className="w-full min-w-0 break-words text-xs text-ink-faint">
        <strong>Logs ERROR</strong> et <strong>Événement custom</strong> se cumulent sur la fenêtre —
        les heures inactives valent zéro pour la baseline. <strong>Issue</strong> somme les occurrences
        observées hors bots ; sa baseline ne retient que les fenêtres où l&apos;issue était suivie, et
        rend « données insuffisantes » sous 4 fenêtres comparables.
      </p>
    </>
  );
}
