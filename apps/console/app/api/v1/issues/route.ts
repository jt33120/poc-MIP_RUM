// GET /api/v1/issues — issues d'erreurs (regroupement v2, P5.5) et groupes
// historiques qu'aucune issue ne reprend, sur la même population que l'écran
// /errors : impact sur la fenêtre, statut, part des occurrences rattachées à une
// issue, échantillonnage. Paginé par curseur. Lecture seule : le triage arrive
// avec ses propres routes (P5.6).
import { handle } from "@/lib/api/handle";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import {
  listIssues,
  parseIssueCursor,
  parseIssueListPage,
  parseIssueRelease,
  parseIssueSource,
  parseIssueStatus,
} from "@/lib/error-issues";
import { errorDeviceFrom, errorScopeFor, scopeApps, type ErrorFilters } from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal, filters, searchParams }) => {
  // AD-16 : une session viewer SANS app n'a accès à rien, avant toute lecture.
  const scope = errorScopeFor({ role: principal.role, apps: principal.apps });
  if (scope.kind === "none") throw new ApiHttpError(403, "aucune application autorisée");

  const status = parseIssueStatus(searchParams.get("status"));
  if (status === undefined) throw new ApiHttpError(400, "status invalide (open, for_review, resolved ou ignored)");
  const source = parseIssueSource(searchParams.get("source"));
  if (source === undefined) throw new ApiHttpError(400, "source invalide");
  const release = parseIssueRelease(searchParams.get("release"));
  if (release === undefined) throw new ApiHttpError(400, "release invalide (1 à 200 caractères, sans caractère de contrôle)");
  const cursor = parseIssueCursor(searchParams.get("cursor"));
  if (cursor === undefined) throw new ApiHttpError(400, "cursor invalide");

  // Mêmes filtres que /api/v1/errors : `legacy` + tablette, jamais `filters.v2.device`.
  const f: ErrorFilters = { ...filters.legacy, device: errorDeviceFrom(filters.device) };
  const result = await listIssues(
    f,
    { status, release, source },
    { limit: parseIssueListPage(searchParams).limit, cursor },
    { apps: scopeApps(scope) },
  );
  // Contrat public énuméré : un champ ajouté à la lecture n'y entre pas sans passer
  // par ici et par la spec OpenAPI.
  return {
    issues: result.issues,
    total: result.total,
    next_cursor: result.next_cursor,
    sampling: result.sampling,
    coverage: result.coverage,
  };
});
