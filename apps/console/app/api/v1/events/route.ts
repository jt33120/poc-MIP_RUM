// GET /api/v1/events — journal RUM minimal, scoped, paginé et ordonné.
import { handle } from "@/lib/api/handle";
import { preflight, ApiHttpError } from "@/lib/api/respond";
import { listEventIndex, parseEventKind, parseEventPage } from "@/lib/queries-events";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const kind = parseEventKind(searchParams.get("kind"));
  if (kind === undefined) throw new ApiHttpError(400, "kind invalide");
  const page = parseEventPage(searchParams);
  const events = await listEventIndex(filters.app, kind, page);
  return { events, page };
});
