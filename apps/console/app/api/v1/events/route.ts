// GET /api/v1/events — journal RUM enrichi, scoped, filtré et ordonné.
import { handle } from "@/lib/api/handle";
import { preflight, ApiHttpError } from "@/lib/api/respond";
import {
  exploreEvents,
  parseEventCursor,
  parseEventPage,
  parseEventQuery,
  type EventFilters,
} from "@/lib/queries-events";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const query = parseEventQuery(searchParams);
  if (!query) throw new ApiHttpError(400, "filtre d’événement invalide");
  const cursor = parseEventCursor(searchParams.get("cursor"));
  if (cursor === undefined) throw new ApiHttpError(400, "cursor invalide");
  const parsedPage = parseEventPage(searchParams);
  // Un curseur est déjà une position : cumuler un offset recréerait des trous.
  const page = cursor ? { ...parsedPage, offset: 0 } : parsedPage;
  const eventFilters: EventFilters = {
    ...filters.legacy,
    device:
      filters.v2.device === "desktop" || filters.v2.device === "mobile" || filters.v2.device === "tablet"
        ? filters.v2.device
        : null,
  };
  return exploreEvents(eventFilters, query, page, cursor);
});
