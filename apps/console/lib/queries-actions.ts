import { parsePagination, type Pagination } from "./api/pagination";
import { q } from "./db";
import { type Filters } from "./filters";
import { sqlContext, type SqlContext } from "./query-sql";

export const ACTIONS_MAX_OFFSET = 10_000;

export interface TopActionRow {
  app_id: string;
  name: string;
  type: "click" | "manual";
  route: string | null;
  actions: number;
  sessions: number;
  errors: number;
  error_clicks: number;
  resources: number;
  api_calls: number;
  resource_ms: number;
  api_ms: number;
  total_ms: number;
  last_seen: Date;
}

export interface ActionSummary {
  actions: number;
  sessions: number;
  errors: number;
  error_clicks: number;
  resources: number;
  api_calls: number;
  resource_ms: number;
  api_ms: number;
  total_ms: number;
  sampling_notice: ActionSamplingNotice | null;
}

export interface ActionSamplingNotice {
  min_sample_rate: number;
  message: string;
}

export function parseActionsPage(searchParams: URLSearchParams, defaultLimit = 50): Pagination {
  const page = parsePagination(searchParams, defaultLimit);
  return { ...page, offset: Math.min(page.offset, ACTIONS_MAX_OFFSET) };
}

export function hasNextActionsPage(page: Pagination, rowCount: number): boolean {
  return rowCount === page.limit && page.offset < ACTIONS_MAX_OFFSET;
}

async function actionsDisponible(): Promise<boolean> {
  const [row] = await q<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    ["public.rum_action"],
  );
  return row?.present === true;
}

/** CTE des actions filtrées par la requête commune, puis de leurs familles causales. */
function actionCtes(ctx: SqlContext): string {
  const where = ctx.where({ dataset: "actions", row: "a", session: "s", time: "a.ts" });
  return `with recursive filtered_actions as (
       select a.action_id, a.app_id, a.session_id, a.name, a.type, a.route, a.ts,
              coalesce(s.sample_rate, 1)::double precision as sample_rate
         from rum_action a
         join rum_session s on s.session_id = a.session_id and s.app_id = a.app_id
        where true${where}
     ), error_totals as (
       select e.action_id, coalesce(sum(e.occurrences), 0)::bigint as n
         from rum_error e join filtered_actions a
           on a.action_id = e.action_id and a.app_id = e.app_id and a.session_id = e.session_id
        group by e.action_id
     ), resource_rows as (
       select r.*
         from rum_resource r join filtered_actions a
           on a.action_id = r.action_id and a.app_id = r.app_id and a.session_id = r.session_id
     ), api_rows as (
       select p.*
         from rum_span p join filtered_actions a
           on a.action_id = p.action_id and a.app_id = p.app_id and a.session_id = p.session_id
        where p.tier = 'front'
     ), network_resource_rows as (
       select r.*,
              row_number() over (
                partition by r.app_id, r.session_id, r.action_id, r.url
                order by r.ts, r.span_id
              )::int as occurrence
         from resource_rows r
        where r.type in ('fetch', 'xhr', 'xmlhttprequest')
     ), numbered_api_rows as (
       select p.*,
              row_number() over (
                partition by p.app_id, p.session_id, p.action_id, p.url
                order by p.ts, p.span_id
              )::int as occurrence
         from api_rows p
     ), resource_groups as (
       select distinct app_id, session_id, action_id, url
         from network_resource_rows
     ), resource_matching (
       app_id, session_id, action_id, url,
       resource_occurrence, api_occurrence, matched_resource_span_id
     ) as (
       select app_id, session_id, action_id, url, 1, 1, null::text
         from resource_groups
       union all
       select m.app_id, m.session_id, m.action_id, m.url,
              case
                when p.ts < r.ts - interval '1 second' then m.resource_occurrence
                else m.resource_occurrence + 1
              end,
              case
                when r.ts < p.ts - interval '1 second' then m.api_occurrence
                else m.api_occurrence + 1
              end,
              case
                when abs(extract(epoch from (p.ts - r.ts))) <= 1 then r.span_id
                else null
              end
         from resource_matching m
         join network_resource_rows r
           on r.app_id = m.app_id and r.session_id = m.session_id and r.action_id = m.action_id
          and r.url is not distinct from m.url and r.occurrence = m.resource_occurrence
         join numbered_api_rows p
           on p.app_id = m.app_id and p.session_id = m.session_id and p.action_id = m.action_id
          and p.url is not distinct from m.url and p.occurrence = m.api_occurrence
     ), resource_api_matches as (
       select app_id, matched_resource_span_id as resource_span_id
         from resource_matching
        where matched_resource_span_id is not null
     ), resource_totals as (
       select r.action_id, count(*)::bigint as n,
              coalesce(sum(r.duration_ms), 0)::double precision as ms
         from resource_rows r
        where not (
          r.type in ('fetch', 'xhr', 'xmlhttprequest') and exists (
            select 1 from resource_api_matches m
             where m.app_id = r.app_id and m.resource_span_id = r.span_id
          )
        )
        group by r.action_id
     ), api_totals as (
       select p.action_id, count(*)::bigint as n,
              coalesce(sum(p.duration_ms), 0)::double precision as ms
         from api_rows p
        group by p.action_id
     ), error_click_totals as (
       select e.action_id, count(*)::bigint as n
         from rum_event e join filtered_actions a
           on a.action_id = e.action_id and a.app_id = e.app_id and a.session_id = e.session_id
        where e.name = 'frustration.error'
        group by e.action_id
     ), per_action as (
       select a.*,
              coalesce(er.n, 0) as errors,
              coalesce(ec.n, 0) as error_clicks,
              coalesce(rr.n, 0) as resources,
              coalesce(ap.n, 0) as api_calls,
              coalesce(rr.ms, 0) as resource_ms,
              coalesce(ap.ms, 0) as api_ms
         from filtered_actions a
         left join error_totals er using (action_id)
         left join resource_totals rr using (action_id)
         left join api_totals ap using (action_id)
         left join error_click_totals ec using (action_id)
     )`;
}

/**
 * Classement calculé intégralement en PostgreSQL. Chaque famille enfant est
 * agrégée PAR action_id avant la jointure : une action avec 2 erreurs et 3
 * ressources reste une racine, jamais six lignes multipliées.
 */
export async function topActions(f: Filters, page: Pagination = { limit: 50, offset: 0 }): Promise<TopActionRow[]> {
  if (!(await actionsDisponible())) return [];
  const ctx = await sqlContext(f);
  const ctes = actionCtes(ctx);
  return q<TopActionRow>(
    `${ctes}
     select app_id, name, type, route,
            count(*)::int as actions,
            count(distinct session_id)::int as sessions,
            coalesce(sum(errors), 0)::int as errors,
            coalesce(sum(error_clicks), 0)::int as error_clicks,
            coalesce(sum(resources), 0)::int as resources,
            coalesce(sum(api_calls), 0)::int as api_calls,
            round(coalesce(sum(resource_ms), 0)::numeric, 1)::float as resource_ms,
            round(coalesce(sum(api_ms), 0)::numeric, 1)::float as api_ms,
            round(coalesce(sum(resource_ms + api_ms), 0)::numeric, 1)::float as total_ms,
            max(ts) as last_seen
       from per_action
      group by app_id, name, type, route
      order by errors desc, total_ms desc, actions desc,
               app_id asc, name asc, type asc, coalesce(route, '') asc
      limit ${ctx.bind(page.limit)} offset ${ctx.bind(page.offset)}`,
    ctx.params,
  );
}

/** Totaux de toute la période filtrée, indépendants de la page affichée. */
export async function topActionsSummary(f: Filters): Promise<ActionSummary> {
  if (!(await actionsDisponible())) return {
    actions: 0, sessions: 0, errors: 0, error_clicks: 0,
    resources: 0, api_calls: 0, resource_ms: 0, api_ms: 0, total_ms: 0,
    sampling_notice: null,
  };
  const ctx = await sqlContext(f);
  const ctes = actionCtes(ctx);
  const [summary] = await q<Omit<ActionSummary, "sampling_notice"> & { min_sample_rate: number | null }>(
    `${ctes}
     select count(*)::int as actions,
            count(distinct session_id)::int as sessions,
            coalesce(sum(errors), 0)::int as errors,
            coalesce(sum(error_clicks), 0)::int as error_clicks,
            coalesce(sum(resources), 0)::int as resources,
            coalesce(sum(api_calls), 0)::int as api_calls,
            round(coalesce(sum(resource_ms), 0)::numeric, 1)::float as resource_ms,
            round(coalesce(sum(api_ms), 0)::numeric, 1)::float as api_ms,
            round(coalesce(sum(resource_ms + api_ms), 0)::numeric, 1)::float as total_ms,
            min(sample_rate)::double precision as min_sample_rate
       from per_action`,
    ctx.params,
  );
  if (summary) {
    const { min_sample_rate, ...totals } = summary;
    return { ...totals, sampling_notice: actionSamplingNotice(min_sample_rate) };
  }
  return {
    actions: 0, sessions: 0, errors: 0, error_clicks: 0,
    resources: 0, api_calls: 0, resource_ms: 0, api_ms: 0, total_ms: 0,
    sampling_notice: null,
  };
}

/** Les actions restent des observations brutes : aucune extrapolation fiable
 * n'est possible après promotion error-biased d'une session. */
export function actionSamplingNotice(min: number | null | undefined): ActionSamplingNotice | null {
  const rate = Number(min);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return null;
  const pct = Math.round(rate * 1000) / 10;
  return {
    min_sample_rate: rate,
    message: `Vue de l’échantillon observé (taux minimal ${pct} %). Les volumes ne sont pas extrapolés et les sessions en erreur peuvent être sur-représentées.`,
  };
}
