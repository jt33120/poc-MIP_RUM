// Requêtes des pages cœur (Overview / Pages lentes / Sessions), filtres globaux v0.3.
// Convention : $1 = app (null = toutes), $2 = device (null = tous) ; l'intervalle vient
// de PERIODS (constantes), jamais d'une entrée utilisateur.
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";
import { buildSegment } from "./segments";

// Lot 2 : exclut le trafic non humain (rum_session.is_bot) par défaut. `alias`
// est constant côté code (jamais une entrée utilisateur). `includeBots` lève le
// filtre. Composé avec le segment sur les mêmes alias (s / ps / ls).
const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

export interface AppItem {
  app_id: string;
  name: string;
}

/** Apps connues : registre + apps vues dans les sessions (non enregistrées). */
export async function listApps(): Promise<AppItem[]> {
  try {
    return await q<AppItem>(
      `select a.app_id, coalesce(r.name, a.app_id) as name
       from (select app_id from app_registry
             union select distinct app_id from rum_session) a
       left join app_registry r using (app_id)
       order by 2`,
    );
  } catch {
    return []; // base indisponible (build) : la console reste rendable
  }
}

/** Apps enregistrées et actives uniquement (registre), pour les sélecteurs de scope. */
export async function registeredApps(): Promise<AppItem[]> {
  return q<AppItem>(`select app_id, name from app_registry where active order by app_id`);
}

export interface VitalAgg {
  name: string;
  p75: number;
  n: number;
}

/** p75 par vital sur la fenêtre courante, ou la fenêtre précédente (shift=true). */
export async function vitalsP75(f: Filters, shift = false): Promise<VitalAgg[]> {
  const itv = PERIODS[f.period].interval;
  const window = shift
    ? `m.ts > now() - interval '${itv}' * 2 and m.ts <= now() - interval '${itv}'`
    : `m.ts > now() - interval '${itv}'`;
  const seg = buildSegment(f.segment, 3);
  return q<VitalAgg>(
    `select m.name,
            percentile_cont(0.75) within group (order by m.value) as p75,
            count(*)::int as n
     from rum_metric m
     left join rum_session s using (session_id)
     where ${window}
       and ($1::text is null or m.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     group by m.name`,
    [f.app, f.device, ...seg.params],
  );
}

export interface OverviewStats {
  sessions: number;
  errors: number;
  pageviews: number;
}

export async function overviewStats(f: Filters, shift = false): Promise<OverviewStats> {
  const itv = PERIODS[f.period].interval;
  const win = (col: string) =>
    shift
      ? `${col} > now() - interval '${itv}' * 2 and ${col} <= now() - interval '${itv}'`
      : `${col} > now() - interval '${itv}'`;
  const seg = buildSegment(f.segment, 3);
  const [row] = await q<OverviewStats>(
    `select
       (select count(*)::int from rum_session s
         where ${win("s.last_seen_at")}
           and ($1::text is null or s.app_id = $1)
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}) as sessions,
       (select count(*)::int from rum_error e
         left join rum_session s using (session_id)
         where ${win("e.ts")}
           and ($1::text is null or e.app_id = $1)
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}) as errors,
       (select count(*)::int from rum_pageview p
         left join rum_session s using (session_id)
         where ${win("p.started_at")}
           and ($1::text is null or p.app_id = $1)
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}) as pageviews`,
    [f.app, f.device, ...seg.params],
  );
  return row;
}

export interface SeriesRow {
  bucket: string;
  p75: number;
}

/** Série temporelle p75 d'un vital, taille de bucket adaptée à la période. */
export async function vitalSeries(f: Filters, name: string): Promise<SeriesRow[]> {
  const { interval, bucket } = PERIODS[f.period];
  const seg = buildSegment(f.segment, 4);
  return q<SeriesRow>(
    `select date_bin('${bucket}', m.ts, timestamptz '2000-01-01') as bucket,
            percentile_cont(0.75) within group (order by m.value) as p75
     from rum_metric m
     left join rum_session s using (session_id)
     where m.name = $3 and m.ts > now() - interval '${interval}'
       and ($1::text is null or m.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     group by 1 order by 1`,
    [f.app, f.device, name, ...seg.params],
  );
}

export interface RouteRow {
  route: string;
  views: number;
  lcp_p75: number | null;
  inp_p75: number | null;
  cls_p75: number | null;
  longtasks: number;
}

export async function slowRoutes(f: Filters): Promise<RouteRow[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  return q<RouteRow>(
    `select m.route,
            (select count(*)::int from rum_pageview p
              left join rum_session ps using (session_id)
              where p.route = m.route and p.started_at > now() - interval '${itv}'
                and ($1::text is null or p.app_id = $1)
                and ($2::text is null or ps.device_type = $2)${seg.where("ps")}${botClause(f, "ps")}) as views,
            percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as lcp_p75,
            percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as inp_p75,
            percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'CLS') as cls_p75,
            (select count(*)::int from rum_longtask l
              left join rum_session ls using (session_id)
              where l.route = m.route and l.ts > now() - interval '${itv}'
                and ($1::text is null or l.app_id = $1)
                and ($2::text is null or ls.device_type = $2)${seg.where("ls")}${botClause(f, "ls")}) as longtasks
     from rum_metric m
     left join rum_session s using (session_id)
     where m.ts > now() - interval '${itv}' and m.route is not null
       and ($1::text is null or m.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     group by m.route
     order by lcp_p75 desc nulls last`,
    [f.app, f.device, ...seg.params],
  );
}

export interface SlowResource {
  route: string;
  url: string;
  type: string | null;
  avg_ms: number;
  n: number;
  render_blocking: boolean | null;
}

/** Top 3 ressources lentes par route (durée moyenne décroissante). */
export async function slowResourcesByRoute(f: Filters): Promise<Map<string, SlowResource[]>> {
  const itv = PERIODS[f.period].interval;
  const rows = await q<SlowResource>(
    `select route, url, type, avg_ms, n, render_blocking from (
       select r.route, r.url, max(r.type) as type,
              avg(r.duration_ms) as avg_ms, count(*)::int as n,
              bool_or(r.render_blocking) as render_blocking,
              row_number() over (partition by r.route order by avg(r.duration_ms) desc) as rk
       from rum_resource r
       left join rum_session s using (session_id)
       where r.ts > now() - interval '${itv}' and r.route is not null
         and ($1::text is null or r.app_id = $1)
         and ($2::text is null or s.device_type = $2)
       group by r.route, r.url
     ) x where rk <= 3`,
    [f.app, f.device],
  );
  const byRoute = new Map<string, SlowResource[]>();
  for (const r of rows) {
    const list = byRoute.get(r.route) ?? [];
    list.push(r);
    byRoute.set(r.route, list);
  }
  return byRoute;
}

export interface SessionRow {
  session_id: string;
  app_id: string;
  device_type: string | null;
  geo_country: string | null;
  user_agent: string | null;
  started_at: Date;
  last_seen_at: Date;
  page_count: number;
  routes: string[] | null;
  err_count: number;
}

export async function listSessions(
  f: Filters,
  page?: { limit?: number; offset?: number },
): Promise<SessionRow[]> {
  const itv = PERIODS[f.period].interval;
  const limit = page?.limit ?? 50;
  const offset = page?.offset ?? 0;
  const seg = buildSegment(f.segment, 5);
  return q<SessionRow>(
    `select s.*, p.routes, coalesce(e.err_count, 0)::int as err_count
     from rum_session s
     left join lateral (
       select array_agg(route order by started_at) as routes
       from rum_pageview where session_id = s.session_id
     ) p on true
     left join lateral (
       select count(*)::int as err_count
       from rum_error where session_id = s.session_id
     ) e on true
     where s.last_seen_at > now() - interval '${itv}'
       and ($1::text is null or s.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     order by s.last_seen_at desc
     limit $3 offset $4`,
    [f.app, f.device, limit, offset, ...seg.params],
  );
}

export interface SessionMeta {
  session_id: string;
  app_id: string;
  client_id: string | null;
  user_hash: string | null;
  user_agent: string | null;
  device_type: string | null;
  geo_country: string | null;
  started_at: Date;
  last_seen_at: Date;
  page_count: number;
}

export async function sessionMeta(id: string): Promise<SessionMeta | null> {
  const [row] = await q<SessionMeta>(`select * from rum_session where session_id = $1`, [id]);
  return row ?? null;
}

export type TimelineKind =
  | "pageview"
  | "vital"
  | "error"
  | "breadcrumb"
  | "longtask"
  | "event"
  | "api";

export interface TimelineItem {
  kind: TimelineKind;
  ts: Date;
  title: string | null; // route | nom du vital | type d'erreur | type de crumb | nom d'event
  detail: string | null; // nav_type | route | message | label | props
  value: number | null; // valeur vital | seq | duration_ms
  rating: string | null; // good|needs-improvement|poor (vitals)
}

/** Timeline fusionnée chronologique d'une session (toutes tables v0.1 + v0.2). */
export async function sessionTimeline(id: string): Promise<TimelineItem[]> {
  return q<TimelineItem>(
    `select kind, ts, title, detail, value, rating from (
       select 'pageview' as kind, started_at as ts, route as title, nav_type as detail,
              null::float as value, null::text as rating
       from rum_pageview where session_id = $1
       union all
       select 'vital', ts, name, route, value, rating
       from rum_metric where session_id = $1
       union all
       select 'error', ts, coalesce(error_type, kind), message, null, null
       from rum_error where session_id = $1
       union all
       select 'breadcrumb', ts, type, label, seq::float, null
       from rum_breadcrumb where session_id = $1
       union all
       select 'longtask', ts, 'Long task', route, duration_ms, null
       from rum_longtask where session_id = $1
       union all
       select 'event', ts, name, props::text, null, null
       from rum_event where session_id = $1
       union all
       -- v0.4 appels API : titre = méthode + chemin, détail = statut + temps serveur corrélé
       select 'api', f.ts,
              f.method || ' ' || regexp_replace(coalesce(f.url, ''), '^https?://[^/]+', ''),
              coalesce(f.status_code::text, '—')
                || coalesce(' · serveur ' || round(b.duration_ms::numeric) || ' ms', ''),
              f.duration_ms,
              case when coalesce(f.status_code, 0) >= 400 or coalesce(f.status_code, 0) = 0
                   then 'poor' end
       from rum_span f
       left join rum_span b on b.trace_id = f.trace_id and b.tier = 'back'
       where f.session_id = $1 and f.tier = 'front'
     ) t
     order by ts asc, kind
     limit 500`,
    [id],
  );
}
