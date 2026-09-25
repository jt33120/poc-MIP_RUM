// GET /api/v1/issues/{id}/tickets — liens et état de livraison, en lecture scopée.
//
// La lecture suit le périmètre du principal : un viewer voit les tickets de son
// app et leur état de livraison. La DEMANDE de création d'un ticket (P8.6) a
// quitté l'API publique en C7 : elle passe par l'écran de l'issue, dont la server
// action appelle sa commande (`lib/commandes/issues.ts`) — un jeton d'API n'a
// jamais eu, et n'a toujours pas, de droit d'écriture EXTERNE.
import { handle } from "@/lib/api/handle";
import { valeurOuErreur } from "@/lib/api/issue-workflow";
import { announceResourceApp } from "@/lib/api/params";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { isIssueId } from "@/lib/error-issues";
import { livraisonsTicket } from "@/lib/queries-ticket-integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, params }) => {
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const lu = valeurOuErreur(await livraisonsTicket(id, filters.query.scope.authorizedApps));
  announceResourceApp(filters, lu.app_id);
  return { deliveries: lu.deliveries };
});
