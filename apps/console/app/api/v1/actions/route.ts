// GET /api/v1/actions — Top Actions causal, scoped et paginé.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { parseActionsPage, topActions, topActionsSummary } from "@/lib/queries-actions";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const page = parseActionsPage(searchParams);
  const [actions, summary] = await Promise.all([
    topActions(filters.legacy, page),
    topActionsSummary(filters.legacy),
  ]);
  return { actions, summary, page };
});
