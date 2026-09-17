// Workflow d'une issue sur son écran (P5.6) : triage et assignation, référence de
// résolution, régression confirmée ou réapparition à vérifier, liens de ticket,
// puis historique et commentaires. Rendu serveur ; les formulaires sont des îlots
// client, rendus pour un admin seulement.
import { ERROR_LINK } from "@/components/errors/ErrorOccurrences";
import { IssueCommentForm, IssueLinkForm, IssueTriageForm } from "@/components/errors/IssueWorkflowForms";
import type { IssueActivity, IssueUserRef, IssueWorkflowView } from "@/lib/error-issue-workflow";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS, type IssueRecord, type IssueStatus } from "@/lib/error-issues";
import { fmtDate } from "@/lib/format";

const CARTE_TITRE = "text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
const NOTICE = "rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-soft";

function personne(ref: IssueUserRef | null): string {
  if (!ref) return "personne";
  return ref.email ?? "compte supprimé";
}

function reference(release: string | null, env: string | null): string {
  if (!release) return "release inconnue";
  return `release ${release}${env ? ` (env ${env})` : " (env inconnu)"}`;
}

/**
 * Carte de triage. `workflow` null : migration-v73 absente, l'état reste lisible
 * mais rien ne se modifie. `canWrite` : admin hors démo — l'API applique la même
 * règle, ce rendu ne fait que ne pas proposer ce qui serait refusé.
 */
export function IssueTriageCard({
  issue,
  workflow,
  canWrite,
  alertHref,
}: {
  issue: IssueRecord;
  workflow: IssueWorkflowView | null;
  canWrite: boolean;
  alertHref: string;
}) {
  return (
    <section className="card mb-6 p-4" aria-labelledby="issue-triage-title" data-testid="issue-triage">
      <h2 id="issue-triage-title" className={CARTE_TITRE}>
        Triage
      </h2>
      {!workflow ? (
        <p role="status" className={`mt-3 ${NOTICE}`}>
          Triage indisponible : migration-v73 non appliquée. L&apos;état de l&apos;issue reste lisible.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-faint">Assignée à</dt>
              <dd data-testid="issue-assignee">{personne(workflow.assignee)}</dd>
            </div>
            {issue.status === "resolved" && issue.resolved_at && (
              <div>
                <dt className="text-xs text-ink-faint">Résolution</dt>
                <dd data-testid="issue-resolution">
                  le {fmtDate(issue.resolved_at)} par {personne(workflow.resolved_by)} — référence{" "}
                  {reference(issue.resolved_release, issue.resolved_env)}
                </dd>
              </div>
            )}
          </dl>
          {workflow.regression && issue.status !== "resolved" && (
            <p role="status" className={`mt-3 ${NOTICE}`} data-testid="issue-regression">
              Régression confirmée le {fmtDate(workflow.regression.created_at)} : une occurrence de la{" "}
              {reference(workflow.regression.release, workflow.regression.env)} est arrivée après la résolution, sur une
              release déployée après la référence {workflow.regression.reference_release}. L&apos;issue a été rouverte.
            </p>
          )}
          {issue.reappeared && (
            <p role="status" className={`mt-3 ${NOTICE}`} data-testid="issue-reappeared">
              Réapparition à vérifier : l&apos;issue est revue depuis sa résolution sans régression confirmée — même
              release que la référence ({reference(issue.resolved_release, issue.resolved_env)}), release plus ancienne,
              sans marqueur de déploiement ou autre env. Elle reste résolue.
            </p>
          )}
          {canWrite ? (
            <div className="mt-4 space-y-4">
              <IssueTriageForm
                issueId={issue.id}
                appId={issue.app_id}
                revision={issue.revision}
                status={issue.status}
                assigneeUserId={workflow.assignee?.user_id ?? null}
                statuts={ISSUE_STATUSES.map((s: IssueStatus) => ({ value: s, label: ISSUE_STATUS_LABELS[s] }))}
                comptes={workflow.assignable_users.map((u) => ({ value: u.user_id, label: u.email ?? u.user_id }))}
              />
              <a href={alertHref} className={`inline-block text-sm ${ERROR_LINK}`} data-testid="issue-alert-link">
                Créer une alerte de pic sur cette issue
              </a>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-faint">Lecture seule : le triage est réservé aux administrateurs.</p>
          )}
          <div className="mt-5">
            <h3 className={CARTE_TITRE}>Tickets liés</h3>
            {workflow.links.length ? (
              <ul className="mt-2 space-y-1 text-sm" data-testid="issue-links">
                {workflow.links.map((lien) => (
                  <li key={lien.id} className="break-all">
                    <a href={lien.url} target="_blank" rel="noopener noreferrer" className={ERROR_LINK}>
                      {lien.label}
                    </a>
                    <span className="text-xs text-ink-faint">
                      {" "}
                      — ajouté par {personne(lien.created_by)} le {fmtDate(lien.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-faint">Aucun ticket lié.</p>
            )}
            {canWrite && (
              <div className="mt-3">
                <IssueLinkForm issueId={issue.id} appId={issue.app_id} revision={issue.revision} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function statut(s: IssueStatus | null): string {
  return s ? `« ${ISSUE_STATUS_LABELS[s]} »` : "?";
}

/** Une ligne d'historique, en clair. Jamais de stack ni de message d'erreur : l'activité n'en porte pas. */
function Evenement({ activite }: { activite: IssueActivity }) {
  const acteur = activite.actor.kind === "system" ? "Système" : (activite.actor.user?.email ?? "compte supprimé");
  switch (activite.kind) {
    case "status":
      return (
        <>
          <strong>{acteur}</strong> a passé l&apos;issue de {statut(activite.old_status)} à {statut(activite.new_status)}
          {activite.new_status === "resolved" && ` — référence ${reference(activite.release, activite.env)}`}.
        </>
      );
    case "assignee":
      return activite.new_assignee ? (
        <>
          <strong>{acteur}</strong> a assigné l&apos;issue à {personne(activite.new_assignee)}.
        </>
      ) : (
        <>
          <strong>{acteur}</strong> a retiré l&apos;assignation ({personne(activite.old_assignee)}).
        </>
      );
    case "comment":
      return (
        <>
          {activite.legacy_fingerprint ? (
            <>
              Note de triage du groupe historique <code className="chip-mono break-all">{activite.legacy_fingerprint}</code>,
              reprise dans l&apos;historique :
            </>
          ) : (
            <>
              <strong>{acteur}</strong> a commenté :
            </>
          )}
          <span className="mt-1 block whitespace-pre-wrap break-words text-ink">{activite.body}</span>
        </>
      );
    case "link":
      return (
        <>
          <strong>{acteur}</strong> a lié le ticket{" "}
          {activite.link && (
            <a href={activite.link.url} target="_blank" rel="noopener noreferrer" className={`break-all ${ERROR_LINK}`}>
              {activite.link.label}
            </a>
          )}
          .
        </>
      );
    case "regression":
      return (
        <>
          <strong>Régression confirmée</strong> : {reference(activite.release, activite.env)} déployée après la référence{" "}
          {activite.reference_release} — l&apos;issue est rouverte.
        </>
      );
  }
}

/** Historique paginé (le plus récent d'abord) et commentaire. Les liens de page sont des ancres natives. */
export function IssueActivitySection({
  issue,
  activities,
  canWrite,
  olderHref,
  newestHref,
}: {
  issue: IssueRecord;
  activities: IssueActivity[] | null;
  canWrite: boolean;
  olderHref: string | null;
  newestHref: string | null;
}) {
  return (
    <section id="activite" className="card mt-6 p-4" aria-labelledby="issue-activity-title" data-testid="issue-activity">
      <h2 id="issue-activity-title" className={CARTE_TITRE}>
        Activité
      </h2>
      {activities === null ? (
        <p role="status" className={`mt-3 ${NOTICE}`}>
          Historique indisponible : migration-v73 non appliquée.
        </p>
      ) : (
        <>
          {canWrite && (
            <div className="mt-3">
              <IssueCommentForm issueId={issue.id} appId={issue.app_id} revision={issue.revision} />
            </div>
          )}
          {activities.length ? (
            <ol className="mt-4 space-y-3 text-sm text-ink-soft">
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-line pl-3" data-testid={`issue-activity-${a.kind}`}>
                  <span className="block text-xs text-ink-faint">{fmtDate(a.created_at)}</span>
                  <Evenement activite={a} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-ink-faint">Aucune activité : ni triage, ni commentaire, ni lien.</p>
          )}
          {(olderHref || newestHref) && (
            <nav aria-label="Pages de l'historique" className="mt-4 flex flex-wrap gap-4 text-sm">
              {newestHref && (
                <a href={newestHref} className={ERROR_LINK}>
                  ← Activité la plus récente
                </a>
              )}
              {olderHref && (
                <a href={olderHref} className={ERROR_LINK}>
                  Activité plus ancienne →
                </a>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
