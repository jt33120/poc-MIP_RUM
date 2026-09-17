// POST /api/v1/issues/{id}/links — lien de ticket saisi à la main (P5.6).
//
// Corps `{app, url, label, expectedRevision}`. Même garde que le triage. URL HTTPS
// sans identifiants, normalisée, 2 048 caractères ; libellé scrubbé de 120. Une
// même URL deux fois sur l'issue : 409. Rien n'est envoyé au fournisseur (P8.6).
import { handleMutation } from "@/lib/api/handle";
import { valeurOuErreur, workflowApps } from "@/lib/api/issue-workflow";
import { ApiHttpError } from "@/lib/api/respond";
import { linkIssue, parseLinkRequest } from "@/lib/error-issue-workflow";
import { isIssueId } from "@/lib/error-issues";

export const dynamic = "force-dynamic";

export const POST = handleMutation(async ({ user, body, params }) => {
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const demande = parseLinkRequest(body);
  if (!demande.ok) throw new ApiHttpError(400, demande.error);
  const cree = valeurOuErreur(
    await linkIssue({ issueId: id, apps: workflowApps(user), actorEmail: user.email }, demande.value),
  );
  return { app: demande.value.app, data: cree, status: 201 };
});
