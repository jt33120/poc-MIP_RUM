// Connecteurs de tickets (P8.6) — configuration, activation, recette.
//
// CETTE PAGE RESTE CACHÉE tant qu'aucun fournisseur n'est branché et testé :
// `surfaceTicketsOuverte()` décide, et un 404 est rendu sinon. Le lien de la
// barre latérale suit la même décision. Montrer un écran d'intégrations à un
// client qui n'en a aucune serait promettre une capacité qu'on n'a pas encore
// tenue chez lui.
//
// GITHUB AUJOURD'HUI, ITSM MIP DEMAIN. La mention est affichée en tête, dans les
// mêmes termes que dans le corps des tickets créés et que sur l'écran d'une
// issue — une seule définition, `MENTION_ETAPE`.
import { notFound } from "next/navigation";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { INPUT_CLASS } from "@/components/forms/Field";
import { chargerConnecteurs } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { MENTION_ETAPE, type TicketIntegration } from "@/lib/queries-ticket-integrations";
import { creerIntegrationAction, majIntegrationAction } from "./actions";

export const dynamic = "force-dynamic";

const NOTICE = "rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft";

/** Ce que l'écran dit d'un secret. Jamais sa valeur : sa FORME, et son nom de variable. */
function secret(ref: TicketIntegration["credential"] | TicketIntegration["webhook"]): string {
  if (!ref) return "aucun";
  if (ref.kind === "env") return `variable ${ref.name}`;
  if (ref.kind === "encrypted") return "chiffré (clé serveur)";
  return "référence invalide";
}

export default async function TicketIntegrationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Le chargeur : les connecteurs et les applications de son périmètre (C9) ; la
  // surface fermée tant qu'aucune recette réelle n'a été jouée (404, comme avant).
  const ecran = accesAdmin(await chargerEcran(ECRANS_ADMIN.connecteurs, chargerConnecteurs, {}));
  if (ecran.etat === "fermee") notFound();
  const sp = await searchParams;
  const erreur = typeof sp.erreur === "string" ? sp.erreur : null;
  const { migre, apps, connecteurs: integrations } = ecran;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Connecteurs de tickets"
        sub={
          <>
            Création de tickets depuis une issue d&apos;erreurs, application par application. Le secret n&apos;est
            jamais stocké ici : le champ attend une <strong>référence</strong> (<code className="chip-mono">env:NOM</code>{" "}
            ou <code className="chip-mono">enc:v1:…</code>).
          </>
        }
      />

      <p className={`mb-6 ${NOTICE}`} data-testid="tickets-etape">
        {MENTION_ETAPE}
      </p>

      {!migre && (
        <div role="alert" className={`mb-6 ${NOTICE}`}>
          Schéma non migré : <code className="chip-mono">migration-v84</code> est requise. La configuration reste
          lisible, aucune écriture n&apos;aboutira.
        </div>
      )}

      {erreur && (
        <div role="alert" className="mb-6 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad-ink" data-testid="tickets-erreur">
          {erreur}
        </div>
      )}

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Configurer un connecteur</h2>
        <form action={creerIntegrationAction} className="flex flex-wrap items-end gap-3" data-testid="tickets-create">
          <label className="text-xs font-medium text-ink-soft">
            Application
            <select name="app" required defaultValue="" className={`${INPUT_CLASS} mt-1 block`}>
              <option value="" disabled>
                choisir…
              </option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name} ({a.app_id})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Fournisseur
            <select name="provider" defaultValue="github" className={`${INPUT_CLASS} mt-1 block`}>
              <option value="github">GitHub Issues</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Dépôt cible (confirmé)
            <input
              name="target"
              required
              placeholder="owner/repo"
              maxLength={200}
              className={`${INPUT_CLASS} mt-1 block w-56`}
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Référence du jeton
            <input
              name="credentialRef"
              required
              placeholder="env:TICKET_GITHUB_TOKEN"
              maxLength={4200}
              className={`${INPUT_CLASS} mt-1 block w-64`}
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Référence du secret de webhook
            <input
              name="webhookSecretRef"
              placeholder="env:TICKET_GITHUB_WEBHOOK"
              maxLength={4200}
              className={`${INPUT_CLASS} mt-1 block w-64`}
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Ticket fermé →
            <select name="mapClosed" defaultValue="" className={`${INPUT_CLASS} mt-1 block`}>
              <option value="">ne rien changer</option>
              <option value="resolved">Résolue</option>
              <option value="for_review">À revoir</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Ticket rouvert →
            <select name="mapReopened" defaultValue="" className={`${INPUT_CLASS} mt-1 block`}>
              <option value="">ne rien changer</option>
              <option value="open">Ouverte</option>
              <option value="for_review">À revoir</option>
            </select>
          </label>
          <button type="submit" className="btn-accent">
            Configurer
          </button>
        </form>
        <p className="mt-3 text-xs text-ink-faint">
          Le mapping de statut est explicite : sans choix, un ticket fermé ne change rien dans MIP. Une issue{" "}
          <strong>ignorée</strong> n&apos;est jamais modifiée par le fournisseur — MIP en reste la source de vérité.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-table text-sm" data-testid="tickets-liste">
          <caption className="px-4 pt-4 text-left text-xs text-ink-faint">
            Connecteurs configurés ({integrations.length})
          </caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Application</th>
              <th scope="col" className="th">Fournisseur / cible</th>
              <th scope="col" className="th">Jeton</th>
              <th scope="col" className="th">Webhook</th>
              <th scope="col" className="th">État</th>
              <th scope="col" className="th">Recette</th>
              <th scope="col" className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {integrations.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-sm text-ink-faint">
                  Aucun connecteur configuré. Le lien de ticket manuel reste disponible sur chaque issue, sans
                  connecteur.
                </td>
              </tr>
            ) : (
              integrations.map((i) => (
                <tr key={i.id} className="border-t border-line/60 align-top">
                  <td className="px-4 py-2 text-xs text-ink-soft">{i.app_id}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {i.provider === "github" ? "GitHub Issues" : i.provider}
                    <span className="block break-all font-mono text-ink-faint">{i.target}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{secret(i.credential)}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{secret(i.webhook)}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {i.enabled ? "Activé" : "Désactivé"}
                    {i.state === "degraded" && (
                      <span className="block text-bad-ink">Dégradé{i.last_error ? ` — ${i.last_error}` : ""}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {i.verified_at ? `jouée le ${fmtDate(i.verified_at)}` : "jamais éprouvée"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      <form action={majIntegrationAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="app" value={i.app_id} />
                        <input type="hidden" name="champ" value="enabled" />
                        <input type="hidden" name="valeur" value={i.enabled ? "0" : "1"} />
                        <button type="submit" className="btn-ghost border border-line px-2 py-1 text-xs">
                          {i.enabled ? "Désactiver" : "Activer"}
                        </button>
                      </form>
                      <form action={majIntegrationAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="app" value={i.app_id} />
                        <input type="hidden" name="champ" value="verified" />
                        <input type="hidden" name="valeur" value={i.verified_at ? "0" : "1"} />
                        <button type="submit" className="btn-ghost border border-line px-2 py-1 text-xs">
                          {i.verified_at ? "Retirer la recette" : "Marquer éprouvé"}
                        </button>
                      </form>
                      {i.state === "degraded" && (
                        <form action={majIntegrationAction}>
                          <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="app" value={i.app_id} />
                          <input type="hidden" name="champ" value="state" />
                          <button type="submit" className="btn-ghost border border-line px-2 py-1 text-xs">
                            Réactiver
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        URL de webhook à déclarer chez le fournisseur :{" "}
        <code className="chip-mono">/api/webhooks/tickets/&lt;identifiant du connecteur&gt;</code>. La signature est
        vérifiée en temps constant ; une livraison rejouée est reconnue et sans effet.
      </p>
    </div>
  );
}
