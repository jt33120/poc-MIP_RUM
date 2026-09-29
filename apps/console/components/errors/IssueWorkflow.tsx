// Workflow d'une issue sur son écran (P5.6) : triage et assignation, référence de
// résolution, régression confirmée ou réapparition à vérifier, puis historique
// et commentaires. Rendu serveur ; les formulaires sont des îlots
// client, rendus pour un admin seulement. Hors session admin, la lecture arrive
// sans adresse de compte (lib/error-issue-workflow.ts) : l'écran dit « un compte
// de la console », jamais « compte supprimé ».
import Link from "next/link";
import { ERROR_LINK } from "@/components/errors/ErrorOccurrences";
import { IssueCommentForm, IssueTriageForm } from "@/components/errors/IssueWorkflowForms";
import type { IssueActivity, IssueUserRef, IssueWorkflowView } from "@/lib/error-issue-workflow";
import type { IssueRecord } from "@/lib/error-issues";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS, type IssueStatus } from "@/lib/issues-libelles";
import { fmtDate } from "@/lib/format";

const CARTE_TITRE = "text-[11px] font-semibold uppercase tracking-wider text-ink-faint";
const NOTICE = "rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink-soft";

/** `emails` : lecture d'une session admin, où une adresse absente veut dire un compte supprimé. */
function personne(ref: IssueUserRef | null, emails: boolean): string {
  if (!ref) return "personne";
  return ref.email ?? (emails ? "compte supprimé" : "un compte de la console");
}

function reference(release: string | null, env: string | null): string {
  if (!release) return "release inconnue";
  return `release ${release}${env ? ` (env ${env})` : " (environnement inconnu)"}`;
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
          Triage indisponible pour le moment. L&apos;état du groupe reste lisible.
        </p>
      ) : (
        <>
          {(!canWrite || (issue.status === "resolved" && issue.resolved_at)) && (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {/* L'administrateur lit l'assigné dans le sélecteur du formulaire, juste
                  dessous : le répéter en texte le disait deux fois (recette du 26/09/2026). */}
              {!canWrite && (
                <div>
                  <dt className="text-xs text-ink-faint">Assigné à</dt>
                  <dd data-testid="issue-assignee">{personne(workflow.assignee, canWrite)}</dd>
                </div>
              )}
              {issue.status === "resolved" && issue.resolved_at && (
                <div>
                  <dt className="text-xs text-ink-faint">Résolution</dt>
                  <dd data-testid="issue-resolution">
                    le {fmtDate(issue.resolved_at)} par {personne(workflow.resolved_by, canWrite)} — référence{" "}
                    {reference(issue.resolved_release, issue.resolved_env)}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {workflow.regression && issue.status !== "resolved" && (
            <p role="status" className={`mt-3 ${NOTICE}`} data-testid="issue-regression">
              Régression confirmée le {fmtDate(workflow.regression.created_at)} : une occurrence de la{" "}
              {reference(workflow.regression.release, workflow.regression.env)} est arrivée après la résolution, sur une
              release déployée après la référence {workflow.regression.reference_release}. Le groupe a été rouvert.
            </p>
          )}
          {issue.reappeared && (
            <p role="status" className={`mt-3 ${NOTICE}`} data-testid="issue-reappeared">
              Réapparition à vérifier : le groupe est revu depuis sa résolution sans régression confirmée — même
              release que la référence ({reference(issue.resolved_release, issue.resolved_env)}), release plus ancienne,
              sans marqueur de déploiement ou autre environnement. Il reste résolu.
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
              <Link href={alertHref} className={`inline-block text-sm ${ERROR_LINK}`} data-testid="issue-alert-link">
                Créer une alerte de pic sur ce groupe
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-faint">Lecture seule : le triage est réservé aux administrateurs.</p>
          )}
        </>
      )}
    </section>
  );
}

function statut(s: IssueStatus | null): string {
  return s ? `« ${ISSUE_STATUS_LABELS[s]} »` : "?";
}

/** Une ligne d'historique, en clair. Jamais de stack ni de message d'erreur : l'activité n'en porte pas. */
function Evenement({ activite, emails }: { activite: IssueActivity; emails: boolean }) {
  const acteur =
    activite.actor.kind === "system"
      ? "Système"
      : (activite.actor.user?.email ?? (emails ? "Compte supprimé" : "Un compte de la console"));
  switch (activite.kind) {
    case "status":
      return (
        <>
          <strong>{acteur}</strong> a passé le groupe de {statut(activite.old_status)} à {statut(activite.new_status)}
          {activite.new_status === "resolved" && ` — référence ${reference(activite.release, activite.env)}`}.
        </>
      );
    case "assignee":
      return activite.new_assignee ? (
        <>
          <strong>{acteur}</strong> a assigné le groupe à {personne(activite.new_assignee, emails)}.
        </>
      ) : (
        <>
          <strong>{acteur}</strong> a retiré l&apos;assignation ({personne(activite.old_assignee, emails)}).
        </>
      );
    case "comment":
      return (
        <>
          {activite.legacy_fingerprint ? (
            <>
              Note de triage de l&apos;ancienne signature <code className="chip-mono break-all">{activite.legacy_fingerprint}</code>,
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
    case "regression":
      return (
        <>
          <strong>Régression confirmée</strong> : {reference(activite.release, activite.env)} déployée après la référence{" "}
          {activite.reference_release} — le groupe est rouvert.
        </>
      );
  }
}

/** Historique paginé (le plus récent d'abord) et commentaire. */
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
          Historique indisponible pour le moment.
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
                  <Evenement activite={a} emails={canWrite} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-ink-faint">Aucune activité : ni triage, ni commentaire.</p>
          )}
          {(olderHref || newestHref) && (
            <nav aria-label="Pages de l'historique" className="mt-4 flex flex-wrap gap-4 text-sm">
              {newestHref && (
                <Link href={newestHref} className={ERROR_LINK}>
                  ← Activité la plus récente
                </Link>
              )}
              {olderHref && (
                <Link href={olderHref} className={ERROR_LINK}>
                  Activité plus ancienne →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
