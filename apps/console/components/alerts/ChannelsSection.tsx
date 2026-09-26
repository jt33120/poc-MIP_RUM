// Section canaux de notification : liste + création (webhook/slack/email) par sévérité.
import { ALERT_SEVERITIES, CHANNEL_KINDS } from "@/lib/alerting";
import { ConfirmationDanger, entreGuillemets } from "@/components/ConfirmationDanger";
import { Field, INPUT_CLASS } from "@/components/forms/Field";
import { createChannelAction, deleteChannelAction, toggleChannelAction } from "@/app/alerts/actions";
import { LockedBadge } from "@/components/LockedBadge";
import { SeverityBadge } from "./SeverityBadge";
import { libelleSeverite } from "@/lib/alertes-metriques";

const EMAIL_TITLE =
  "Canal e-mail inactif : aucune alerte n'est envoyée par e-mail tant qu'un service d'envoi (Scaleway TEM, Brevo ou SES) n'est pas configuré. Webhook et Slack fonctionnent.";

/** Section routing : liste des canaux + création (webhook/slack/email), filtrés par sévérité. */
export function ChannelsSection({
  channels,
  apps,
  defaultApp,
  admin = false,
  global = admin,
}: {
  channels: { id: number; app_id: string | null; kind: string; target: string; severity_min: string; active: boolean }[];
  apps: { app_id: string; name: string }[];
  defaultApp?: string;
  /** V9 : sans droit d'écriture, ni formulaire ni bouton dans le DOM (F64). */
  admin?: boolean;
  /** C8 : un canal GLOBAL (toutes les applications) est réservé à l'administrateur de la plateforme. */
  global?: boolean;
}) {
  return (
    <div className="mt-10" id="canaux">
      <h2 className="mb-1 text-base font-bold tracking-tight">Canaux de notification</h2>
      <p className="mb-3 text-sm text-ink-soft">
        Envoient les alertes (en plus du webhook de la règle) vers d&apos;autres destinations, filtrées par
        sévérité minimale. Sans application choisie, le canal vaut pour toutes. <strong>Webhook et Slack</strong>{" "}
        sont livrés&nbsp;; <strong>l&apos;e-mail est inactif</strong> tant qu&apos;un service d&apos;envoi
        n&apos;est pas configuré (rien n&apos;est envoyé par e-mail — aucune alerte silencieusement perdue en
        croyant qu&apos;elle part).
      </p>

      {admin && (
      <details className="card mb-6" open={!channels.length}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          + Nouveau canal
        </summary>
        <form
          action={createChannelAction}
          className="flex flex-wrap items-end gap-3 border-t border-line p-4"
        >
          <Field label="App (optionnel)">
            <select name="app_id" defaultValue={defaultApp ?? (global ? "" : apps[0]?.app_id)} className={INPUT_CLASS}>
              {global && <option value="">toutes les applications</option>}
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
                  {k === "email" ? "e-mail (inactif — service d’envoi requis)" : k}
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
          <Field label="Sévérité minimale">
            <select name="severity_min" defaultValue="warning" className={INPUT_CLASS}>
              {ALERT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {libelleSeverite(s)}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" data-testid="create-channel" className="btn-accent">
            Créer
          </button>
        </form>
      </details>
      )}

      <div className="flex flex-col gap-3">
        {channels.map((c) => (
          <div
            key={c.id}
            data-testid={`channel-${c.id}`}
            className={`card flex flex-wrap items-center gap-3 p-4 ${c.active ? "" : "opacity-60"}`}
          >
            <span className="font-mono text-xs text-ink-faint">#{c.id}</span>
            <span className="rounded bg-panel2 px-2 py-0.5 text-xs font-medium text-ink-soft">
              {c.kind === "email" ? "e-mail" : c.kind}
            </span>
            <span className="truncate font-mono text-sm">{c.target}</span>
            <span className="text-xs text-ink-faint">
              {c.app_id ?? "toutes les applications"} · à partir de <SeverityBadge severity={c.severity_min} />
            </span>
            {c.kind === "email" ? (
              <LockedBadge label="Non livré — service d’envoi requis" title={EMAIL_TITLE} />
            ) : (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  c.active
                    ? "bg-good/10 text-good-ink"
                    : "bg-panel2 text-ink-faint"
                }`}
              >
                {c.active ? "actif" : "désactivé"}
              </span>
            )}
            {admin && (
            <div className="ml-auto flex gap-2">
              <form action={toggleChannelAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                <button
                  type="submit"
                  data-testid={`toggle-channel-${c.id}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition ${
                    c.active ? "bg-slate-500 hover:bg-slate-600" : "bg-good-fond hover:bg-good-fond/90"
                  }`}
                >
                  {c.active ? "Désactiver" : "Activer"}
                </button>
              </form>
              {/* Supprimer un canal fait taire ses alertes sans bruit : confirmé. L'encadré
                  flotte sous le bouton plutôt que d'agrandir la carte et d'en déplacer les éléments. */}
              <form action={deleteChannelAction}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmationDanger
                  libelle="Supprimer"
                  libelleAccessible={`Supprimer le canal ${c.target}`}
                  question={`Supprimer le canal ${entreGuillemets(c.target)}\u00a0?`}
                  consequence="Les alertes ne seront plus envoyées vers cette destination ; il faudra la déclarer de nouveau pour les y recevoir."
                  confirmer="Supprimer le canal"
                  enCours="Suppression…"
                  flottant
                  classeDeclencheur="rounded-lg border border-bad/40 bg-panel px-3 py-1.5 text-xs font-medium text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40"
                  testid={`delete-channel-${c.id}`}
                />
              </form>
            </div>
            )}
          </div>
        ))}
        {!channels.length && (
          <p className="py-4 text-center text-sm text-ink-faint">
            {admin
              ? "Aucun canal : ajoutez-en un ci-dessus pour que les alertes soient envoyées."
              : "Aucun canal de notification : aucune alerte n'est routée. Demandez à un administrateur d'en ajouter un."}
          </p>
        )}
      </div>
    </div>
  );
}
