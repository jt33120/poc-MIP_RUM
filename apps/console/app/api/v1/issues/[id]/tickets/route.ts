// POST /api/v1/issues/{id}/tickets — demande de création d'un ticket (P8.6).
// GET  /api/v1/issues/{id}/tickets — liens et état de livraison, en lecture scopée.
//
// Corps `{app, integrationId, expectedRevision}` → **202** `{jobId, state}` : le
// ticket n'existe PAS encore quand on répond, et prétendre le contraire serait
// faux. Sa création est faite par la file de sortie, au tick suivant.
//
// Mêmes gardes que le triage : jeton d'API (lecture seule), viewer et démo
// refusés par `handleMutation`. Un jeton `CONSOLE_API_TOKENS` n'obtient jamais
// un droit d'écriture EXTERNE — c'est la règle qui compte le plus ici, puisque
// l'écriture sort du produit.
//
// La lecture, elle, suit le périmètre du principal : un viewer voit les tickets
// de son app et leur état de livraison, sans pouvoir en déclencher un.
import { handle, handleMutation } from "@/lib/api/handle";
import { valeurOuErreur, workflowApps } from "@/lib/api/issue-workflow";
import { announceResourceApp } from "@/lib/api/params";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { isIssueId } from "@/lib/error-issues";
import {
  demanderTicket,
  livraisonsTicket,
  origineConsole,
  parseDemandeTicket,
} from "@/lib/queries-ticket-integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

export const POST = handleMutation(async ({ req, user, body, params }) => {
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const demande = parseDemandeTicket(body);
  if (!demande.ok) throw new ApiHttpError(400, demande.error);
  const cree = valeurOuErreur(
    await demanderTicket(
      { issueId: id, apps: workflowApps(user), actorEmail: user.email },
      demande.value,
      origineConsole(req.headers),
    ),
  );
  return {
    app: demande.value.app,
    status: 202 as const,
    // `payload` est renvoyé pour que l'appelant puisse vérifier que ce qui a été
    // figé est bien ce qu'on lui avait montré — pas pour l'afficher à nouveau.
    data: { jobId: cree.jobId, state: cree.state, payload: cree.payload, revision: cree.revision },
  };
});

export const GET = handle(async ({ filters, params }) => {
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const lu = valeurOuErreur(await livraisonsTicket(id, filters.query.scope.authorizedApps));
  announceResourceApp(filters, lu.app_id);
  return { deliveries: lu.deliveries };
});
