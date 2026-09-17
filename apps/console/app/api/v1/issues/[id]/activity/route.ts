// GET /api/v1/issues/{id}/activity — historique d'une issue (P5.6) : statuts,
// assignations, commentaires, liens et régressions, le plus récent d'abord.
//
// Lecture : session ou jeton, dans le périmètre du principal. L'identifiant fait
// foi : `meta.app` annonce l'app de l'issue. Pagination par curseur `(created_at,
// id)` à la microseconde, `limit` de 1 à 100. Les adresses des comptes ne partent
// que vers une session admin : `email` vaut null pour un jeton ou un viewer.
import { handle } from "@/lib/api/handle";
import { ISSUE_INTROUVABLE, valeurOuErreur } from "@/lib/api/issue-workflow";
import { parsePagination } from "@/lib/api/pagination";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT, listIssueActivity } from "@/lib/error-issue-workflow";
import { isIssueId } from "@/lib/error-issues";
import { errorScopeFor, parseErrorCursor, scopeApps } from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal, filters, searchParams, params }) => {
  const scope = errorScopeFor({ role: principal.role, apps: principal.apps });
  if (scope.kind === "none") throw new ApiHttpError(404, ISSUE_INTROUVABLE);
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const cursor = parseErrorCursor(searchParams.get("cursor"));
  if (cursor === undefined) throw new ApiHttpError(400, "cursor invalide");
  const { limit } = parsePagination(searchParams, ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT);

  const lu = valeurOuErreur(
    await listIssueActivity(id, scopeApps(scope), { limit: limit || ACTIVITY_DEFAULT_LIMIT, cursor }, {
      emails: principal.kind === "session" && principal.role === "admin",
    }),
  );
  filters.app = lu.app_id;
  return { activities: lu.activities, next_cursor: lu.next_cursor };
});
