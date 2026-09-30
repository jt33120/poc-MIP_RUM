// Section canaux de notification : liste + création (webhook/slack/email) par sévérité.
//
// UNE LIGNE PAR CANAL (recette du 30/09/2026) : type en pastille, cible en chasse fixe,
// périmètre, sévérité minimale, état, gestes. Le paragraphe d'explication (ce qu'un
// canal ajoute au webhook d'une règle, l'e-mail inactif) passe en résumé d'une ligne ;
// la phrase entière reste lue par un lecteur d'écran.
import { ALERT_SEVERITIES, CHANNEL_KINDS } from "@/lib/alerting";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
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
    <section className="mt-6 min-w-0 scroll-mt-20" id="canaux" aria-labelledby="canaux-titre">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="canaux-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          Canaux de notification
        </h2>
        <span className="text-[11px] text-ink-faint" aria-hidden>
          webhook et Slack livrés · e-mail inactif sans service d&apos;envoi
        </span>
      </div>
      <p className="sr-only">
        Envoient les alertes (en plus du webhook de la règle) vers d&apos;autres destinations, filtrées par
        sévérité minimale. Sans application choisie, le canal vaut pour toutes. Webhook et Slack sont livrés ;
        l&apos;e-mail est inactif tant qu&apos;un service d&apos;envoi n&apos;est pas configuré (rien n&apos;est
        envoyé par e-mail — aucune alerte silencieusement perdue en croyant qu&apos;elle part).
      </p>

      <div className="card min-w-0 divide-y divide-line/60">
        {channels.map((c) => (
          <div
            key={c.id}
            data-testid={`channel-${c.id}`}
            className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs ${c.active ? "" : "opacity-60"}`}
          >
            <span className="font-mono text-[10px] text-ink-faint">#{c.id}</span>
            <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              {c.kind === "email" ? "e-mail" : c.kind}
            </span>
            <span className="min-w-0 max-w-full truncate font-mono text-[12px] text-ink sm:max-w-[28rem]" title={c.target}>
              {c.target}
            </span>
            <span className="text-ink-faint">
              {c.app_id ?? "toutes les applications"} · à partir de <SeverityBadge severity={c.severity_min} />
            </span>
            {c.kind === "email" ? (
              <LockedBadge label="Non livré — service d’envoi requis" title={EMAIL_TITLE} />
            ) : (
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  c.active ? "bg-good/10 text-good-ink" : "bg-panel2 text-ink-faint"
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
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium text-white transition ${
                      c.active ? "bg-slate-500 hover:bg-slate-600" : "bg-good-fond hover:bg-good-fond/90"
                    }`}
                  >
                    {c.active ? "Désactiver" : "Activer"}
                  </button>
                </form>
                {/* Supprimer un canal fait taire ses alertes sans bruit : confirmé. L'encadré
                    flotte sous le bouton plutôt que d'agrandir la ligne et d'en déplacer les éléments. */}
                <form action={deleteChannelAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <ConfirmationDanger
                    libelle="Supprimer"
                    libelleAccessible={`Supprimer le canal ${c.target}`}
                    question={`Supprimer le canal ${entreGuillemets(c.target)} ?`}
                    consequence="Les alertes ne seront plus envoyées vers cette destination ; il faudra la déclarer de nouveau pour les y recevoir."
                    confirmer="Supprimer le canal"
                    enCours="Suppression…"
                    flottant
                    classeDeclencheur="rounded-lg border border-bad/40 bg-panel px-2.5 py-1 text-xs font-medium text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40"
                    testid={`delete-channel-${c.id}`}
                  />
                </form>
              </div>
            )}
          </div>
        ))}
        {!channels.length && (
          // Une ligne dans la carte, pas une boîte : l'absence de canal est déjà dite en tête d'écran.
          <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft" role="status">
            <span aria-hidden className="text-ink-faint">
              ⊘
            </span>
            {admin
              ? "Aucun canal : ajoutez-en un ci-dessous pour que les alertes soient envoyées."
              : "Aucun canal de notification : aucune alerte n'est routée. Demandez à un administrateur d'en ajouter un."}
          </p>
        )}
      </div>

      {admin && (
        <details className="card mt-2" open={!channels.length}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-soft transition hover:text-ink">
            + Nouveau canal
          </summary>
          <form action={createChannelAction} className="flex flex-wrap items-end gap-3 border-t border-line p-3">
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
              <input name="target" required placeholder="https://hooks.slack.com/…" className={`${INPUT_CLASS} w-72 max-w-full font-mono`} />
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
    </section>
  );
}
