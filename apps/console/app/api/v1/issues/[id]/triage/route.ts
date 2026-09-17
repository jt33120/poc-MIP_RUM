// POST /api/v1/issues/{id}/triage — statut et/ou assigné d'une issue (P5.6).
//
// Corps `{app, status?, assigneeUserId?, expectedRevision}`, au moins une mutation.
// Session admin de la console et même origine : jeton de lecture, viewer et démo
// refusés par handleMutation, `/api/v1` contournant le middleware. L'assignation
// ne change jamais le statut ; résoudre fige la release et l'env de référence de
// la dernière occurrence. 409 avec la révision courante si l'issue a changé
// depuis sa lecture.
import { handleMutation } from "@/lib/api/handle";
import { valeurOuErreur, workflowApps } from "@/lib/api/issue-workflow";
import { ApiHttpError } from "@/lib/api/respond";
import { parseTriageRequest, triageIssue } from "@/lib/error-issue-workflow";
import { isIssueId } from "@/lib/error-issues";

export const dynamic = "force-dynamic";

export const POST = handleMutation(async ({ user, body, params }) => {
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const demande = parseTriageRequest(body);
  if (!demande.ok) throw new ApiHttpError(400, demande.error);
  const issue = valeurOuErreur(
    await triageIssue({ issueId: id, apps: workflowApps(user), actorEmail: user.email }, demande.value),
  );
  return { app: issue.app_id, data: { issue } };
});
