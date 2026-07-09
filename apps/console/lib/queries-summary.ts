// Résumé RUM propriétaire (livrable UTI) — agrégats TECHNIQUES uniquement (aucune
// PII : ni IP, ni contenu DOM, ni email). Scopé app + fenêtre, trafic bot exclu.
// Produit exactement le contrat /api/rum/summary. Tous les numériques sont castés
// (::int) pour revenir en nombres (pas de string bigint/numeric), null si absent.
import { q } from "./db";
import type { SummaryWindow } from "./read-tokens";

export interface SummarySeriesPoint {
  date: string;
  sessions: number;
  page_views: number;
  errors: number;
  avg_load_ms: number | null;
}
export interface SummaryRoute {
  route: string;
  views: number;
  avg_ms: number | null;
  errors: number;
}
export interface SummaryError {
  message: string;
  count: number;
  last_seen: string;
}
export interface RumSummary {
  app: string;
  window: SummaryWindow;
  generated_at: string;
  sessions: number;
  users: number;
  page_views: number;
  avg_load_ms: number | null;
  p75_lcp_ms: number | null;
  p75_inp_ms: number | null;
  error_rate: number | null;
  frustration_signals: number;
  series: SummarySeriesPoint[];
  top_routes: SummaryRoute[];
  top_errors: SummaryError[];
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** Construit le résumé pour un app + une fenêtre (intervalle Postgres). */
export async function rumSummary(
  app: string,
  windowKey: SummaryWindow,
  interval: string,
  generatedAt: string,
): Promise<RumSummary> {
  const p = [app, interval];

  const [kpis, series, routes, errors] = await Promise.all([
    q<{
      sessions: number;
      users: number;
      page_views: number;
      avg_load_ms: number | null;
      p75_lcp_ms: number | null;
      p75_inp_ms: number | null;
      frustration_signals: number;
      error_sessions: number;
    }>(
      `select
         (select count(distinct p.session_id)::int from rum_pageview p join rum_session s on s.session_id=p.session_id
            where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false)) as sessions,
         (select count(distinct s.user_hash)::int from rum_session s
            where s.app_id=$1 and s.started_at>now()-$2::interval and not coalesce(s.is_bot,false) and s.user_hash is not null) as users,
         (select count(*)::int from rum_pageview p join rum_session s on s.session_id=p.session_id
            where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false)) as page_views,
         (select round(avg(m.value))::int from rum_metric m join rum_session s on s.session_id=m.session_id
            where m.app_id=$1 and m.name='FCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as avg_load_ms,
         (select percentile_cont(0.75) within group (order by m.value)::int from rum_metric m join rum_session s on s.session_id=m.session_id
            where m.app_id=$1 and m.name='LCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as p75_lcp_ms,
         (select percentile_cont(0.75) within group (order by m.value)::int from rum_metric m join rum_session s on s.session_id=m.session_id
            where m.app_id=$1 and m.name='INP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as p75_inp_ms,
         (select count(*)::int from rum_event e join rum_session s on s.session_id=e.session_id
            where e.app_id=$1 and e.name in ('frustration.rage','frustration.dead') and e.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as frustration_signals,
         (select count(distinct e.session_id)::int from rum_error e join rum_session s on s.session_id=e.session_id
            where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as error_sessions`,
      p,
    ),
    q<SummarySeriesPoint>(
      `select to_char(d::date,'YYYY-MM-DD') as date,
              coalesce(pv.sessions,0)::int as sessions,
              coalesce(pv.page_views,0)::int as page_views,
              coalesce(er.errors,0)::int as errors,
              fcp.avg_load_ms
       from generate_series((now()-$2::interval)::date, now()::date, interval '1 day') d
       left join (
         select date_trunc('day',p.started_at)::date dd, count(distinct p.session_id) sessions, count(*) page_views
         from rum_pageview p join rum_session s on s.session_id=p.session_id
         where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false) group by 1
       ) pv on pv.dd=d::date
       left join (
         select date_trunc('day',e.ts)::date dd, count(*) errors
         from rum_error e join rum_session s on s.session_id=e.session_id
         where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false) group by 1
       ) er on er.dd=d::date
       left join (
         select date_trunc('day',m.ts)::date dd, round(avg(m.value))::int avg_load_ms
         from rum_metric m join rum_session s on s.session_id=m.session_id
         where m.app_id=$1 and m.name='FCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false) group by 1
       ) fcp on fcp.dd=d::date
       order by d`,
      p,
    ),
    q<SummaryRoute>(
      `with pv as (
         select p.route, count(*)::int views from rum_pageview p join rum_session s on s.session_id=p.session_id
         where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false) and p.route is not null group by p.route
       ), er as (
         select e.route, count(*)::int errors from rum_error e join rum_session s on s.session_id=e.session_id
         where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false) and e.route is not null group by e.route
       ), fcp as (
         select m.route, round(avg(m.value))::int avg_ms from rum_metric m join rum_session s on s.session_id=m.session_id
         where m.app_id=$1 and m.name='FCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false) and m.route is not null group by m.route
       )
       select pv.route, pv.views, fcp.avg_ms, coalesce(er.errors,0)::int errors
       from pv left join er using(route) left join fcp using(route)
       order by pv.views desc limit 10`,
      p,
    ),
    q<{ message: string; count: number; last_seen: string }>(
      `select left(e.message,200) as message, count(*)::int as count, max(e.ts) as last_seen
       from rum_error e join rum_session s on s.session_id=e.session_id
       where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false)
         and e.message is not null and e.message <> ''
       group by left(e.message,200)
       order by count(*) desc limit 10`,
      p,
    ),
  ]);

  const k = kpis[0];
  const sessions = k?.sessions ?? 0;
  const errorRate = sessions > 0 ? (k?.error_sessions ?? 0) / sessions : null;

  return {
    app,
    window: windowKey,
    generated_at: generatedAt,
    sessions,
    users: k?.users ?? 0,
    page_views: k?.page_views ?? 0,
    avg_load_ms: n(k?.avg_load_ms),
    p75_lcp_ms: n(k?.p75_lcp_ms),
    p75_inp_ms: n(k?.p75_inp_ms),
    error_rate: errorRate == null ? null : Math.round(errorRate * 10000) / 10000,
    frustration_signals: k?.frustration_signals ?? 0,
    series: series.map((s) => ({ ...s, avg_load_ms: n(s.avg_load_ms) })),
    top_routes: routes.map((r) => ({ ...r, avg_ms: n(r.avg_ms) })),
    top_errors: errors.map((e) => ({ message: e.message, count: e.count, last_seen: iso(e.last_seen) })),
  };
}
