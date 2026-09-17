// POST /api/v1/issues/{id}/comments — commentaire d'une issue (P5.6).
//
// Corps `{app, body, expectedRevision}`. Même garde que le triage. Le texte est
// scrubbé avant stockage et borné à 2 000 caractères APRÈS masquage ; il reste
// dans la console — aucun envoi vers un outil de tickets (P8.6).
import { handleMutation } from "@/lib/api/handle";
import { valeurOuErreur, workflowApps } from "@/lib/api/issue-workflow";
import { ApiHttpError } from "@/lib/api/respond";
import { commentIssue, parseCommentRequest } from "@/lib/error-issue-workflow";
import { isIssueId } from "@/lib/error-issues";

export const dynamic = "force-dynamic";

export const POST = handleMutation(async ({ user, body, params }) => {
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const demande = parseCommentRequest(body);
  if (!demande.ok) throw new ApiHttpError(400, demande.error);
  const cree = valeurOuErreur(
    await commentIssue({ issueId: id, apps: workflowApps(user), actorEmail: user.email }, demande.value),
  );
  return { app: demande.value.app, data: cree, status: 201 };
});
