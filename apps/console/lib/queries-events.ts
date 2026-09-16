// Contrat unique de lecture des événements RUM. Les valeurs utilisateur restent
// des paramètres liés ; seules les périodes et largeurs de bucket issues de
// PERIODS sont interpolées dans le SQL.
import { parsePagination, type Pagination } from "./api/pagination";
import { q, tx } from "./db";
import { PERIODS, type Filters } from "./filters";
import { internalClause } from "./queries";
import { buildSegment } from "./segments";

export type EventFilters = Omit<Filters, "device"> & {
  device: "desktop" | "mobile" | "tablet" | null;
};

export const EVENT_INDEX_KINDS = [
  "pageview", "vital", "error", "resource", "longtask", "breadcrumb", "event", "span",
] as const;
export type EventIndexKind = (typeof EVENT_INDEX_KINDS)[number];

export const EVENT_ATTRIBUTE_SOURCES = ["props", "context"] as const;
export type EventAttributeSource = (typeof EVENT_ATTRIBUTE_SOURCES)[number];
export const EVENT_ATTRIBUTE_TYPES = ["string", "number", "boolean", "null"] as const;
export type EventAttributeType = (typeof EVENT_ATTRIBUTE_TYPES)[number];

const EVENT_NAME = /^[^\u0000-\u001F\u007F]{1,100}$/u;
const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const MAX_ATTRIBUTE_STRING = 500;
const MAX_CURSOR_LENGTH = 512;
export const EVENT_INDEX_MAX_OFFSET = 10_000;

export interface EventAttributeFilter {
  source: EventAttributeSource;
  key: string;
  type: EventAttributeType;
  value: string | number | boolean | null;
}

export interface EventQuery {
  kind: EventIndexKind | null;
  name: string | null;
  attribute: EventAttributeFilter | null;
}

export interface EventIndexRow {
  id: string;
  app_id: string;
  session_id: string | null;
  ts: Date;
  route: string | null;
  kind: EventIndexKind;
  source_name: string | null;
  source_span_id: string;
  name?: string | null;
  props?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  device_type?: string | null;
}

export interface EventTrendRow { bucket: Date; count: number }
export interface EventNameFacet { value: string; count: number }
export interface EventAttributeFacet { source: EventAttributeSource; key: string; count: number }
export interface EventValueFacet { type: EventAttributeType; value: string | null; count: number }
export interface EventSamplingNotice { min_sample_rate: number; message: string }

export interface EventExplorerResult {
  events: EventIndexRow[];
  page: Pagination & { next_cursor: string | null };
  total: number;
  trend: EventTrendRow[];
  facets: {
    names: EventNameFacet[];
    attributes: EventAttributeFacet[];
    values: EventValueFacet[];
  };
  sampling_notice: EventSamplingNotice | null;
  enrichment: { available: boolean; diagnostic: string | null };
}

interface EventCursor { ts: string; id: string }
interface EventIndexInternalRow extends EventIndexRow { cursor_ts: string }

/** `undefined` signale une valeur hostile à refuser; `null`, aucun filtre. */
export function parseEventKind(value: string | null): EventIndexKind | null | undefined {
  if (value == null || value === "") return null;
  return (EVENT_INDEX_KINDS as readonly string[]).includes(value) ? value as EventIndexKind : undefined;
}

export function parseEventName(value: string | null): string | null | undefined {
  if (value == null || value.trim() === "") return null;
  const name = value.trim();
  return EVENT_NAME.test(name) ? name : undefined;
}

export function isValidEventName(value: string): boolean {
  return parseEventName(value) === value;
}

function primitiveValue(type: EventAttributeType, raw: string | null, present: boolean) {
  if (type === "null") return { ok: true as const, value: null };
  if (!present || raw == null) return { ok: false as const };
  if (type === "string") {
    return raw.length <= MAX_ATTRIBUTE_STRING
      ? { ok: true as const, value: raw }
      : { ok: false as const };
  }
  if (type === "number") {
    const value = Number(raw);
    return Number.isFinite(value) && raw.trim() !== ""
      ? { ok: true as const, value }
      : { ok: false as const };
  }
  if (raw === "true" || raw === "false") return { ok: true as const, value: raw === "true" };
  return { ok: false as const };
}

/** Filtre d'attribut exact : primitive top-level seulement, jamais JSONPath/regex. */
export function parseEventAttribute(sp: URLSearchParams): EventAttributeFilter | null | undefined {
  const rawSource = sp.get("attr_source");
  const rawKey = sp.get("attr_key");
  const rawType = sp.get("attr_type");
  // The HTML form always submits the default attr_type. Treat an otherwise
  // empty attribute row as no filter instead of rejecting name-only searches.
  const rawValue = sp.get("attr_value");
  const hasAny = [rawSource, rawKey, rawValue].some((value) => value != null && value !== "");
  if (!hasAny) {
    // `string` est la valeur par défaut du formulaire HTML. Toute autre valeur
    // isolée indique en revanche un filtre partiel et doit être rejetée.
    return rawType == null || rawType === "" || rawType === "string" ? null : undefined;
  }
  if (!(EVENT_ATTRIBUTE_SOURCES as readonly string[]).includes(rawSource ?? "")) return undefined;
  if (!rawKey || !ATTRIBUTE_KEY.test(rawKey)) return undefined;
  if (!(EVENT_ATTRIBUTE_TYPES as readonly string[]).includes(rawType ?? "")) return undefined;
  const typed = primitiveValue(rawType as EventAttributeType, sp.get("attr_value"), sp.has("attr_value"));
  if (!typed.ok) return undefined;
  return {
    source: rawSource as EventAttributeSource,
    key: rawKey,
    type: rawType as EventAttributeType,
    value: typed.value,
  };
}

export function parseEventQuery(sp: URLSearchParams): EventQuery | undefined {
  const kind = parseEventKind(sp.get("kind"));
  const name = parseEventName(sp.get("name"));
  const attribute = parseEventAttribute(sp);
  if (kind === undefined || name === undefined || attribute === undefined) return undefined;
  // Les noms et propriétés n'existent que sur la famille custom `event`.
  if ((name || attribute) && kind != null && kind !== "event") return undefined;
  return { kind: name || attribute ? "event" : kind, name, attribute };
}

export function parseEventPage(searchParams: URLSearchParams): Pagination {
  const page = parsePagination(searchParams, 100);
  return { ...page, offset: Math.min(page.offset, EVENT_INDEX_MAX_OFFSET) };
}

export function encodeEventCursor(row: Pick<EventIndexRow, "ts" | "id"> & { cursor_ts?: string }): string {
  const ts = row.cursor_ts ?? new Date(row.ts).toISOString();
  return Buffer.from(JSON.stringify([ts, row.id]), "utf8").toString("base64url");
}

export function parseEventCursor(value: string | null): EventCursor | null | undefined {
  if (value == null || value === "") return null;
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) return undefined;
    const [ts, id] = decoded;
    if (typeof ts !== "string" || ts.length > 40 || !Number.isFinite(Date.parse(ts))) return undefined;
    if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return undefined;
    if (BigInt(id) > 9_223_372_036_854_775_807n) return undefined;
    // Ne pas repasser par Date : JavaScript tronque les microsecondes alors que
    // PostgreSQL les conserve. Sur deux événements au même instant, cette perte
    // ferait tomber toute la page suivante du curseur `(ts,id)`.
    return { ts, id };
  } catch {
    return undefined;
  }
}

async function schemaStatus(): Promise<{ p1: boolean; p4: boolean }> {
  const [row] = await q<{ p1: boolean; p4: boolean }>(
    `select to_regclass($1) is not null as p1,
            to_regprocedure($2) is not null as p4`,
    ["public.rum_event_index", "public.event_metric_baseline(text,text,text,integer,integer)"],
  );
  return { p1: row?.p1 === true, p4: row?.p4 === true };
}

function samplingNotice(min: number | null | undefined): EventSamplingNotice | null {
  const rate = Number(min);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return null;
  const pct = Math.round(rate * 1000) / 10;
  return {
    min_sample_rate: rate,
    message: `Comptes observés sur un échantillon (taux minimal ${pct} %). Aucune extrapolation : les sessions en erreur peuvent être sur-représentées.`,
  };
}

function attributeJson(attribute: EventAttributeFilter | null): string | null {
  return attribute ? JSON.stringify(attribute.value) : null;
}

/** Base partagée par journal, total, tendance, facettes et widget. */
function filteredCte(
  f: EventFilters,
  query: EventQuery,
  cursor: EventCursor | null,
  includeCursor = true,
): { sql: string; params: unknown[]; nextIndex: number } {
  const interval = PERIODS[f.period].interval;
  // Les sept premiers binds forment le contrat stable des filtres événement.
  // Le curseur garde $8/$9 pour rester inspectable, puis le segment commence à
  // $10 (ou $8 sans curseur).
  const segment = buildSegment(f.segment, includeCursor ? 10 : 8);
  const params: unknown[] = [
    f.app, f.device, query.kind, query.name,
    query.attribute?.source ?? null, query.attribute?.key ?? null,
    attributeJson(query.attribute),
    ...(includeCursor ? [cursor?.ts ?? null, cursor?.id ?? null] : []),
    ...segment.params,
  ];
  const attributePredicate = query.attribute
    ? `and $5::text = '${query.attribute.source}'
       and e.${query.attribute.source} @> jsonb_build_object($6::text, $7::jsonb)`
    : "and $5::text is null and $6::text is null and $7::jsonb is null";
  return {
    params,
    nextIndex: params.length + 1,
    sql: `with filtered_events as (
      select i.id, i.app_id, i.session_id, i.ts, i.route, i.kind,
             i.source_name, i.source_span_id,
             e.name, e.props, e.context, s.device_type,
             coalesce(s.sample_rate, 1)::double precision as sample_rate
        from rum_event_index i
        left join rum_event e
          on i.kind = 'event' and e.app_id = i.app_id and e.span_id = i.source_span_id
        left join rum_session s
          on s.app_id = i.app_id and s.session_id = i.session_id
       where i.ts > now() - interval '${interval}' and i.ts <= now()
         and ($1::text is null or i.app_id = $1)
         and ($2::text is null or s.device_type = $2)
         and ($3::text is null or i.kind = $3)
         and ($4::text is null or (i.kind = 'event' and e.name = $4))
         and ($3::text is distinct from 'event' or coalesce(e.event_type, 'custom') = 'custom')
         ${attributePredicate}
         ${includeCursor ? "and ($8::timestamptz is null or (i.ts, i.id) < ($8::timestamptz, $9::bigint))" : ""}
         ${segment.where("s")}
         ${f.includeBots ? "" : "and not coalesce(s.is_bot, false)"}
         ${internalClause(f, "i.app_id")}
    )`,
  };
}

async function listP1(f: EventFilters, kind: EventIndexKind | null, page: Pagination): Promise<EventIndexRow[]> {
  const interval = PERIODS[f.period].interval;
  const segment = buildSegment(f.segment, 6);
  return q<EventIndexRow>(
    `select i.id::text as id, i.app_id, i.session_id, i.ts, i.route, i.kind, i.source_name, i.source_span_id
       from rum_event_index i
       left join rum_session s on s.app_id = i.app_id and s.session_id = i.session_id
      where i.ts > now() - interval '${interval}' and i.ts <= now()
        and ($1::text is null or i.app_id = $1)
        and ($2::text is null or s.device_type = $2)
        and ($3::text is null or i.kind = $3)
        ${segment.where("s")}
        ${f.includeBots ? "" : "and not coalesce(s.is_bot, false)"}
        ${internalClause(f, "i.app_id")}
      order by i.ts desc, i.id desc limit $4 offset $5`,
    [f.app, f.device, kind, page.limit, page.offset, ...segment.params],
  );
}

async function countP1(f: EventFilters, kind: EventIndexKind | null): Promise<number> {
  const interval = PERIODS[f.period].interval;
  const segment = buildSegment(f.segment, 4);
  const [row] = await q<{ total: number }>(
    `select count(*)::float8 as total
       from rum_event_index i
       left join rum_session s on s.app_id = i.app_id and s.session_id = i.session_id
      where i.ts > now() - interval '${interval}' and i.ts <= now()
        and ($1::text is null or i.app_id = $1)
        and ($2::text is null or s.device_type = $2)
        and ($3::text is null or i.kind = $3)
        ${segment.where("s")}
        ${f.includeBots ? "" : "and not coalesce(s.is_bot, false)"}
        ${internalClause(f, "i.app_id")}`,
    [f.app, f.device, kind, ...segment.params],
  );
  return Number(row?.total ?? 0);
}

/** Compatibilité P1 interne : conservée pour les anciens appelants/tests. */
export async function listEventIndex(app: string | null, kind: EventIndexKind | null, page: Pagination) {
  const status = await schemaStatus();
  if (!status.p1) return [];
  return q<EventIndexRow>(
    `select id::text as id, app_id, session_id, ts, route, kind, source_name, source_span_id
       from rum_event_index
      where ($1::text is null or app_id = $1) and ($2::text is null or kind = $2)
      order by ts desc, id desc limit $3 offset $4`,
    [app, kind, page.limit, page.offset],
  );
}

export async function exploreEvents(
  f: EventFilters,
  query: EventQuery,
  page: Pagination,
  cursor: EventCursor | null,
): Promise<EventExplorerResult> {
  const status = await schemaStatus();
  const empty = (diagnostic: string): EventExplorerResult => ({
    events: [], page: { ...page, next_cursor: null }, total: 0, trend: [],
    facets: { names: [], attributes: [], values: [] }, sampling_notice: null,
    enrichment: { available: false, diagnostic },
  });
  if (!status.p1) return empty("migration v65 absente : projection d’événements indisponible");
  if (!status.p4) {
    const events = query.name || query.attribute ? [] : await listP1(f, query.kind, page);
    const total = query.name || query.attribute ? 0 : await countP1(f, query.kind);
    return {
      ...empty("migration v68 absente : journal P1 disponible, tendances et facettes désactivées"),
      events,
      page: { ...page, next_cursor: null },
      total,
    };
  }

  return tx(async (client) => {
    // Une seule photographie et une seule horloge pour les six lectures : une
    // ingestion concurrente ne peut pas faire diverger journal/total/facettes.
    await client.query("set transaction isolation level repeatable read read only");
    const run = async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
      (await client.query(sql, params)).rows as T[];
    const listBase = filteredCte(f, query, cursor, true);
    const aggregateBase = filteredCte(f, query, null, false);
    const bucket = PERIODS[f.period].bucket;
    const interval = PERIODS[f.period].interval;
    const listParams = [...listBase.params, page.limit, page.offset];
    const rawEvents = await run<EventIndexInternalRow>(
      `${listBase.sql}
       select id::text, app_id, session_id, ts, route, kind, source_name, source_span_id,
              name, props, context, device_type,
              to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
         from filtered_events
        order by ts desc, id desc limit $${listBase.nextIndex} offset $${listBase.nextIndex + 1}`,
      listParams,
    );
    const totalRows = await run<{ total: number; min_sample_rate: number | null }>(
      `${aggregateBase.sql}
       select count(*)::float8 as total, min(sample_rate)::double precision as min_sample_rate
         from filtered_events`,
      aggregateBase.params,
    );
    const trend = await run<EventTrendRow>(
      `${aggregateBase.sql}, bounds as (
         select date_bin(interval '${bucket}', now() - interval '${interval}', timestamptz '2000-01-01') as start,
                date_bin(interval '${bucket}', now(), timestamptz '2000-01-01') as stop
       ), buckets as (
         select generate_series(start, stop, interval '${bucket}') as bucket from bounds
       ), counts as (
         select date_bin(interval '${bucket}', ts, timestamptz '2000-01-01') as bucket,
                count(*)::float8 as count
           from filtered_events group by 1
       )
       select b.bucket, coalesce(c.count, 0)::float8 as count
         from buckets b left join counts c using (bucket) order by b.bucket`,
      aggregateBase.params,
    );
    const names = await run<EventNameFacet>(
      `${aggregateBase.sql}
       select name as value, count(*)::float8 as count from filtered_events
        where kind = 'event' and name is not null
        group by name order by count desc, name asc limit 20`,
      aggregateBase.params,
    );
    const attributes = await run<EventAttributeFacet>(
      `${aggregateBase.sql}, attrs as (
         select 'props'::text as source, a.key, a.value from filtered_events f
         cross join lateral jsonb_each(case
           when jsonb_typeof(f.props) = 'object' and octet_length(f.props::text) <= 16384 then f.props
           else '{}'::jsonb end) a where f.kind = 'event'
         union all
         select 'context'::text, a.key, a.value from filtered_events f
         cross join lateral jsonb_each(case
           when jsonb_typeof(f.context) = 'object' and octet_length(f.context::text) <= 32768 then f.context
           else '{}'::jsonb end) a where f.kind = 'event'
       )
       select source, key, count(*)::float8 as count from attrs
        where key ~ '^[A-Za-z][A-Za-z0-9_.-]{0,99}$'
          and jsonb_typeof(value) in ('string','number','boolean','null')
        group by source, key order by count desc, source, key limit 30`,
      aggregateBase.params,
    );
    const valuesBase = query.attribute
      ? filteredCte(f, { ...query, attribute: null }, null, false)
      : null;
    const values = query.attribute && valuesBase
      ? await run<EventValueFacet>(
          `${valuesBase.sql}
           select jsonb_typeof(${query.attribute.source} -> $${valuesBase.nextIndex}::text) as type,
                  case when jsonb_typeof(${query.attribute.source} -> $${valuesBase.nextIndex}::text) = 'null'
                       then null else ${query.attribute.source} ->> $${valuesBase.nextIndex}::text end as value,
                  count(*)::float8 as count
             from filtered_events
            where jsonb_typeof(${query.attribute.source} -> $${valuesBase.nextIndex}::text) in ('string','number','boolean','null')
            group by 1, 2 order by count desc, value limit 20`,
          [...valuesBase.params, query.attribute.key],
        )
      : [];
    const last = rawEvents.length === page.limit ? rawEvents.at(-1) : undefined;
    const events = rawEvents.map(({ cursor_ts: _cursorTs, ...event }) => event);
    const total = totalRows[0];
    return {
      events,
      page: { ...page, next_cursor: last ? encodeEventCursor(last) : null },
      total: Number(total?.total ?? 0),
      trend,
      facets: { names, attributes, values },
      sampling_notice: samplingNotice(total?.min_sample_rate),
      enrichment: { available: true, diagnostic: null },
    };
  });
}

/** Compteur du widget : même filtre app/période/device et même table source. */
export async function eventCount(f: EventFilters, name: string): Promise<{
  count: number | null;
  sampling_notice: EventSamplingNotice | null;
  available: boolean;
  diagnostic: string | null;
}> {
  if (parseEventName(name) !== name) {
    return { count: null, sampling_notice: null, available: false, diagnostic: "nom d’événement invalide" };
  }
  const status = await schemaStatus();
  if (!status.p4) {
    return {
      count: null,
      sampling_notice: null,
      available: false,
      diagnostic: "migration v68 absente : compteur indisponible",
    };
  }
  const base = filteredCte(f, { kind: "event", name, attribute: null }, null, false);
  const [row] = await q<{ count: number; min_sample_rate: number | null }>(
    `${base.sql} select count(*)::float8 as count, min(sample_rate)::double precision as min_sample_rate from filtered_events`,
    base.params,
  );
  return {
    count: Number(row?.count ?? 0),
    sampling_notice: samplingNotice(row?.min_sample_rate),
    available: true,
    diagnostic: null,
  };
}
