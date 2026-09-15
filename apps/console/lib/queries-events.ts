// Projection de lecture v1 des événements RUM. Cette requête ne joint aucune
// table source sensible : rum_event_index est précisément la frontière minimale
// créée pour les parcours Explorer et actions futurs.
import { q } from "./db";
import { parsePagination, type Pagination } from "./api/pagination";

export const EVENT_INDEX_KINDS = [
  "pageview",
  "vital",
  "error",
  "resource",
  "longtask",
  "breadcrumb",
  "event",
  "span",
] as const;

export type EventIndexKind = (typeof EVENT_INDEX_KINDS)[number];

/** `undefined` signale une valeur hostile à refuser; `null`, aucun filtre. */
export function parseEventKind(value: string | null): EventIndexKind | null | undefined {
  if (value == null || value === "") return null;
  return (EVENT_INDEX_KINDS as readonly string[]).includes(value)
    ? (value as EventIndexKind)
    : undefined;
}

export const EVENT_INDEX_MAX_OFFSET = 10_000;

/** L'offset est borné pour éviter qu'une page hostile ne déclenche un scan profond. */
export function parseEventPage(searchParams: URLSearchParams): Pagination {
  const page = parsePagination(searchParams, 100);
  return { ...page, offset: Math.min(page.offset, EVENT_INDEX_MAX_OFFSET) };
}

export interface EventIndexRow {
  /** bigint PostgreSQL sérialisé en chaîne, jamais en Number JS imprécis. */
  id: string;
  app_id: string;
  session_id: string | null;
  ts: Date;
  route: string | null;
  kind: EventIndexKind;
  source_name: string | null;
  source_span_id: string;
}

/** La migration est manuelle : avant v65, l'endpoint reste lisible et vide. */
async function eventIndexDisponible(): Promise<boolean> {
  const [row] = await q<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    ["public.rum_event_index"],
  );
  return row?.present === true;
}

/** Liste stable : timestamp décroissant, puis clé primaire décroissante. */
export async function listEventIndex(
  app: string | null,
  kind: EventIndexKind | null,
  page: Pagination,
): Promise<EventIndexRow[]> {
  if (!(await eventIndexDisponible())) return [];
  return q<EventIndexRow>(
    `select id::text as id, app_id, session_id, ts, route, kind, source_name, source_span_id
       from rum_event_index
      where ($1::text is null or app_id = $1)
        and ($2::text is null or kind = $2)
      order by ts desc, id desc
      limit $3 offset $4`,
    [app, kind, page.limit, page.offset],
  );
}
