// Contrat unique de lecture des événements RUM. Plage [from,to), périmètre d'apps,
// appareil (tablette comprise), dimensions, segment, bots et apps internes viennent
// du contrat commun (lib/query-compiler.ts) ; les valeurs utilisateur restent des
// paramètres liés. Seules les largeurs de seau calculées sont interpolées.
import { parsePagination, type Pagination } from "./api/pagination";
import { q, tx } from "./db";
import { queryOf, type FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql, sessionJoin } from "./query-compiler";
import { contextFor, type SqlContext } from "./query-sql";
import { dimensionSchema } from "./query-schema";

export type EventFilters = FiltersLike;


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

/**
 * Base partagée par journal, total, tendance, facettes et widget. Chaque appel lie
 * ses propres paramètres dans `ctx` : une instruction ne déclare que les `$n`
 * qu'elle utilise.
 */
function filteredCte(ctx: SqlContext, query: EventQuery, cursor: EventCursor | null): string {
  const kind = ctx.bind(query.kind);
  const name = ctx.bind(query.name);
  // `source` vient de l'énumération props|context validée par le parseur.
  const attribute = query.attribute
    ? ` and e.${query.attribute.source} @> jsonb_build_object(${ctx.bind(query.attribute.key)}::text, ${ctx.bind(attributeJson(query.attribute))}::jsonb)`
    : "";
  const curseur = cursor
    ? ` and (i.ts, i.id) < (${ctx.bind(cursor.ts)}::timestamptz, ${ctx.bind(cursor.id)}::bigint)`
    : "";
  const where = ctx.where({ dataset: "events", row: "i", session: "s", time: "i.ts" });
  return `with filtered_events as (
      select i.id, i.app_id, i.session_id, i.ts, i.route, i.kind,
             i.source_name, i.source_span_id,
             e.name, e.props, e.context, s.device_type,
             coalesce(s.sample_rate, 1)::double precision as sample_rate
        from rum_event_index i
        left join rum_event e
          on i.kind = 'event' and e.app_id = i.app_id and e.span_id = i.source_span_id
        ${sessionJoin("i", "s")}
       where (${kind}::text is null or i.kind = ${kind}::text)
         and (${name}::text is null or (i.kind = 'event' and e.name = ${name}::text))
         and (${kind}::text is distinct from 'event' or coalesce(e.event_type, 'custom') = 'custom')${attribute}${curseur}${where}
    )`;
}

async function eventContext(f: EventFilters): Promise<{ make: () => SqlContext }> {
  const query = queryOf(f);
  const schema = await dimensionSchema();
  return { make: () => contextFor(query, schema) };
}

async function listP1(f: EventFilters, kind: EventIndexKind | null, page: Pagination): Promise<EventIndexRow[]> {
  const ctx = (await eventContext(f)).make();
  const genre = ctx.bind(kind);
  const where = ctx.where({ dataset: "events", row: "i", session: "s", time: "i.ts" });
  return q<EventIndexRow>(
    `select i.id::text as id, i.app_id, i.session_id, i.ts, i.route, i.kind, i.source_name, i.source_span_id
       from rum_event_index i
       ${sessionJoin("i", "s")}
      where (${genre}::text is null or i.kind = ${genre}::text)${where}
      order by i.ts desc, i.id desc limit ${ctx.bind(page.limit)} offset ${ctx.bind(page.offset)}`,
    ctx.params,
  );
}

async function countP1(f: EventFilters, kind: EventIndexKind | null): Promise<number> {
  const ctx = (await eventContext(f)).make();
  const genre = ctx.bind(kind);
  const where = ctx.where({ dataset: "events", row: "i", session: "s", time: "i.ts" });
  const [row] = await q<{ total: number }>(
    `select count(*)::float8 as total
       from rum_event_index i
       ${sessionJoin("i", "s")}
      where (${genre}::text is null or i.kind = ${genre}::text)${where}`,
    ctx.params,
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

  const contexte = await eventContext(f);
  return tx(async (client) => {
    // Une seule photographie et une seule horloge pour les six lectures : une
    // ingestion concurrente ne peut pas faire diverger journal/total/facettes.
    await client.query("set transaction isolation level repeatable read read only");
    const run = async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
      (await client.query(sql, params)).rows as T[];

    const list = contexte.make();
    const rawEvents = await run<EventIndexInternalRow>(
      `${filteredCte(list, query, cursor)}
       select id::text, app_id, session_id, ts, route, kind, source_name, source_span_id,
              name, props, context, device_type,
              to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
         from filtered_events
        order by ts desc, id desc limit ${list.bind(page.limit)} offset ${list.bind(page.offset)}`,
      list.params,
    );
    const totals = contexte.make();
    const totalRows = await run<{ total: number; min_sample_rate: number | null }>(
      `${filteredCte(totals, query, null)}
       select count(*)::float8 as total, min(sample_rate)::double precision as min_sample_rate
         from filtered_events`,
      totals.params,
    );
    const series = contexte.make();
    const range = series.query.range;
    const trend = await run<EventTrendRow>(
      `${filteredCte(series, query, null)}, buckets as (
         select ${bucketSeriesSql(range, series.bind)} as bucket
       ), counts as (
         select ${bucketExpr("ts", range)} as bucket, count(*)::float8 as count
           from filtered_events group by 1
       )
       select b.bucket, coalesce(c.count, 0)::float8 as count
         from buckets b left join counts c using (bucket) order by b.bucket`,
      series.params,
    );
    const facetNames = contexte.make();
    const names = await run<EventNameFacet>(
      `${filteredCte(facetNames, query, null)}
       select name as value, count(*)::float8 as count from filtered_events
        where kind = 'event' and name is not null
        group by name order by count desc, name asc limit 20`,
      facetNames.params,
    );
    const facetAttributes = contexte.make();
    const attributes = await run<EventAttributeFacet>(
      `${filteredCte(facetAttributes, query, null)}, attrs as (
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
      facetAttributes.params,
    );
    let values: EventValueFacet[] = [];
    if (query.attribute) {
      const facetValues = contexte.make();
      const cte = filteredCte(facetValues, { ...query, attribute: null }, null);
      const key = facetValues.bind(query.attribute.key);
      const source = query.attribute.source;
      values = await run<EventValueFacet>(
        `${cte}
         select jsonb_typeof(${source} -> ${key}::text) as type,
                case when jsonb_typeof(${source} -> ${key}::text) = 'null'
                     then null else ${source} ->> ${key}::text end as value,
                count(*)::float8 as count
           from filtered_events
          where jsonb_typeof(${source} -> ${key}::text) in ('string','number','boolean','null')
          group by 1, 2 order by count desc, value limit 20`,
        facetValues.params,
      );
    }
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

/** Compteur du widget : même requête commune et même table source que l'Explorer. */
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
  const ctx = (await eventContext(f)).make();
  const [row] = await q<{ count: number; min_sample_rate: number | null }>(
    `${filteredCte(ctx, { kind: "event", name, attribute: null }, null)}
     select count(*)::float8 as count, min(sample_rate)::double precision as min_sample_rate from filtered_events`,
    ctx.params,
  );
  return {
    count: Number(row?.count ?? 0),
    sampling_notice: samplingNotice(row?.min_sample_rate),
    available: true,
    diagnostic: null,
  };
}
