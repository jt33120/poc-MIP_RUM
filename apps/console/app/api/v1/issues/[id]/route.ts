// GET /api/v1/issues/{id} — détail d'une issue d'erreurs (P5.5) : l'issue et ses
// groupes historiques, puis impact, tendance, dernier exemplaire et occurrences
// liées sur la fenêtre et les filtres demandés.
//
// L'IDENTIFIANT FAIT FOI. Un UUID d'issue est global : l'app de l'issue est celle
// des chiffres, quelle que soit `app` dans la requête, et `meta.app` l'annonce. Une
// issue hors du périmètre du principal n'existe pas pour lui (404). Une issue sans
// occurrence sur la fenêtre reste lisible : son URL ne casse pas quand le bug se tait.
import { handle } from "@/lib/api/handle";
import { announceResourceApp } from "@/lib/api/params";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { isIssueId, issueDetail, resolveIssue } from "@/lib/error-issues";
import { exemplarSymbolication } from "@/lib/error-symbolication";
import { errorDeviceFrom, parseErrorCursor, parseOccurrencesPage, type ErrorFilters } from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const INTROUVABLE = "issue introuvable";

export const GET = handle(async ({ filters, searchParams, params }) => {
  // Périmètre déjà résolu par `handle` (AD-16) : sans app autorisée, 403 avant d'arriver ici.
  const id = params.id ?? "";
  if (!isIssueId(id)) throw new ApiHttpError(400, "id invalide (UUID attendu)");
  const cursor = parseErrorCursor(searchParams.get("cursor"));
  if (cursor === undefined) throw new ApiHttpError(400, "cursor invalide");
  const { limit } = parseOccurrencesPage(searchParams);

  const issue = await resolveIssue(id, filters.query.scope.authorizedApps);
  if (!issue) throw new ApiHttpError(404, INTROUVABLE);

  const f: ErrorFilters = { ...filters.legacy, device: errorDeviceFrom(filters.device) };
  const detail = await issueDetail(issue, { ...f, app: issue.app_id }, { limit, cursor });
  announceResourceApp(filters, issue.app_id);
  // Stack source (P5.4), comme /errors/{fingerprint} : `stack` reste la stack brute.
  const symbolication = await exemplarSymbolication(issue.app_id, detail.last_sample);
  return {
    issue: { ...detail.issue, grouping_active: detail.grouping_active, legacy_groups: detail.legacy_groups },
    impact: detail.impact,
    trend: detail.trend,
    last_sample: detail.last_sample && {
      ...detail.last_sample,
      stack_symbolicated: symbolication?.stack_symbolicated ?? null,
      symbolication_status: symbolication?.symbolication_status ?? null,
    },
    occurrences: detail.occurrences,
    next_cursor: detail.next_cursor,
    sampling: detail.sampling,
  };
});
