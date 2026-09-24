// Connecteur de tickets sur l'écran d'une issue (P8.6).
//
// CE QUE CETTE CARTE MONTRE, ET POURQUOI EXACTEMENT ÇA. Le titre, la description
// et le lien affichés ici SONT ceux qui partiront : ils viennent du même calcul
// que la charge figée par la file de sortie, sur la même lecture de l'issue. Ce
// n'est pas un aperçu « fidèle », c'est le contenu. Un opérateur qui crée un
// ticket chez un client doit pouvoir lire, avant de cliquer, ce que son client
// va recevoir — et pouvoir constater que la pile d'appels et les identités n'y
// sont pas.
//
// LA CARTE N'EXISTE PAS SANS CONNECTEUR. Sans intégration activée, vérifiée et
// non dégradée pour cette application, rien de tout ceci n'est rendu : le
// formulaire « Lier un ticket » de P5.6 reste la seule voie, et il fonctionne
// sans connecteur — c'était le cas avant ce lot, ça l'est encore.
// La mention vient de l'adaptateur lui-même (aucun import) : passer par
// queries-ticket-integrations.ts ferait atteindre la base à ce composant.
import { MENTION_ETAPE } from "@mip/backend/lib/integrations/tickets/adapter.mjs";
import type { TicketApercu, TicketIntegration, TicketLivraison } from "@/lib/queries-ticket-integrations";
import { IssueTicketForm } from "@/components/errors/IssueWorkflowForms";
import type { IssueRecord } from "@/lib/error-issues";
import { fmtDate } from "@/lib/format";

const CARTE_TITRE = "text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
const NOTICE = "rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-soft";
const BLOC =
  "mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-xs text-ink-soft";

/** Ce que l'écran dit de chaque état de livraison. Aucun n'est muet. */
const ETATS: Record<TicketLivraison["state"], string> = {
  pending: "En attente d'envoi",
  sent: "Créé chez le fournisseur",
  failed: "Échec — rien n'a été créé",
  delivery_uncertain: "Livraison incertaine : un opérateur doit vérifier chez le fournisseur avant toute relance",
  cancelled: "Annulée",
};

/** Codes d'échec rendus en français. Un code inconnu s'affiche tel quel, jamais masqué. */
const RAISONS: Record<string, string> = {
  auth_refusee: "le fournisseur a refusé le jeton (révoqué, expiré ou sans droit)",
  cible_introuvable: "la cible configurée est introuvable ou inaccessible",
  charge_refusee: "le fournisseur a refusé le contenu",
  debit_depasse: "débit du fournisseur dépassé — nouvelle tentative programmée",
  erreur_distante: "panne du fournisseur — nouvelle tentative programmée",
  livraison_incertaine: "délai dépassé après l'envoi : le ticket existe peut-être",
  reponse_illisible: "réponse du fournisseur illisible",
  fournisseur_inconnu: "aucun adaptateur pour ce fournisseur",
  variable_absente: "le secret référencé n'est pas fourni au runtime",
  variable_hors_perimetre: "la variable référencée n'est pas dédiée au connecteur (préfixe TICKET_ exigé)",
  cle_serveur_absente: "la clé serveur de déchiffrement n'est pas configurée",
  dechiffrement_refuse: "le secret chiffré n'a pas pu être déchiffré",
};

export function IssueTicketCard({
  issue,
  integrations,
  apercu,
  deliveries,
  canWrite,
}: {
  issue: IssueRecord;
  integrations: TicketIntegration[];
  apercu: TicketApercu | null;
  deliveries: TicketLivraison[];
  canWrite: boolean;
}) {
  // Aucun connecteur utilisable et aucune demande passée : la surface reste
  // cachée. Une carte vide n'apprendrait rien et promettrait quelque chose.
  if (integrations.length === 0 && deliveries.length === 0) return null;

  return (
    <section className="card mb-6 p-4" aria-labelledby="issue-tickets-title" data-testid="issue-tickets">
      <h2 id="issue-tickets-title" className={CARTE_TITRE}>
        Créer un ticket
      </h2>
      <p className={`mt-3 ${NOTICE}`} data-testid="issue-tickets-etape">
        {MENTION_ETAPE}
      </p>

      {canWrite && integrations.length > 0 && apercu ? (
        <>
          <p className="mt-4 text-sm text-ink-soft">
            Voici <strong>exactement</strong> ce qui sera envoyé. La pile d&apos;appels complète et les identités ne
            sortent pas de MIP RUM.
          </p>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-ink-faint">Titre</dt>
              <dd className={BLOC} data-testid="issue-ticket-titre">
                {apercu.titre}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-faint">Description</dt>
              <dd className={BLOC} data-testid="issue-ticket-description">
                {apercu.description}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-faint">Lien console inclus</dt>
              <dd className={BLOC} data-testid="issue-ticket-lien">
                {apercu.url}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <IssueTicketForm
              issueId={issue.id}
              appId={issue.app_id}
              revision={issue.revision}
              integrations={integrations.map((i) => ({
                id: i.id,
                label: `${i.provider === "github" ? "GitHub Issues" : i.provider} — ${i.target}`,
              }))}
            />
          </div>
        </>
      ) : canWrite && integrations.length > 0 ? (
        <p role="status" className={`mt-3 ${NOTICE}`}>
          Le contenu du ticket n&apos;a pas pu être composé : recharger la page pour réessayer.
        </p>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">
          {canWrite
            ? "Aucun connecteur activé et éprouvé pour cette application : le lien de ticket manuel reste disponible."
            : "Lecture seule : la création de ticket est réservée aux administrateurs."}
        </p>
      )}

      <div className="mt-5">
        <h3 className={CARTE_TITRE}>Demandes de création</h3>
        {deliveries.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">Aucune demande pour cette issue.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-table text-sm" data-testid="issue-ticket-livraisons">
              <caption className="mb-2 text-left text-xs text-ink-faint">
                Demandes de ticket de cette issue, la plus récente d&apos;abord
              </caption>
              <thead className="bg-panel2">
                <tr>
                  <th scope="col" className="th">Destination</th>
                  <th scope="col" className="th">État</th>
                  <th scope="col" className="th">Tentatives</th>
                  <th scope="col" className="th">Ticket</th>
                  <th scope="col" className="th">Demandée</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-line/60 align-top">
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {d.provider === "github" ? "GitHub Issues" : d.provider} — {d.target}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {ETATS[d.state]}
                      {d.last_error && (
                        <span className="block text-ink-faint">{RAISONS[d.last_error] ?? d.last_error}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{d.attempts}</td>
                    <td className="break-all px-4 py-2 text-xs text-ink-soft">
                      {d.external_url ? (
                        <a href={d.external_url} target="_blank" rel="noopener noreferrer" className="underline">
                          {d.external_id ? `#${d.external_id}` : d.external_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {fmtDate(d.created_at)}
                      {d.sent_at && <span className="block text-ink-faint">créé le {fmtDate(d.sent_at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
