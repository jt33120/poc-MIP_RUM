// Requêtes /tracing (v0.4) — corrélation front↔back par trace_id (rum_span).
// Même convention que queries.ts : $1 = app (null = toutes), $2 = device,
// intervalle exclusivement depuis PERIODS.
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";

export interface TraceCoverage {
  total: number; // appels API vus du navigateur (spans front)
  correlated: number; // dont jumeau backend trouvé (même trace_id)
  back_total: number; // spans back reçus (inclut le trafic sans front : robots, curl)
  front_p75: number | null;
  back_p75: number | null;
}

export async function traceCoverage(f: Filters): Promise<TraceCoverage> {
  const itv = PERIODS[f.period].interval;
  const [row] = await q<TraceCoverage>(
    `select
       count(*) filter (where f.tier = 'front')::int as total,
       count(b.span_id)::int as correlated,
       (select count(*)::int from rum_span
         where tier = 'back' and ts > now() - interval '${itv}'
           and ($1::text is null or app_id = $1)) as back_total,
       percentile_cont(0.75) within group (order by f.duration_ms) as front_p75,
       percentile_cont(0.75) within group (order by b.duration_ms) as back_p75
     from rum_span f
     left join rum_span b on b.trace_id = f.trace_id and b.tier = 'back'
     left join rum_session s on s.session_id = f.session_id
     where f.tier = 'front' and f.ts > now() - interval '${itv}'
       and ($1::text is null or f.app_id = $1)
       and ($2::text is null or s.device_type = $2)`,
    [f.app, f.device],
  );
  return row;
}

export interface ApiCallRow {
  url: string; // chemin vu du navigateur (origin retirée)
  method: string;
  n: number;
  front_p75: number;
  back_p75: number | null;
  err: number; // statuts >= 400 ou 0 (réseau)
}

/** Appels API vus du navigateur, avec le temps serveur corrélé quand il existe. */
export async function apiCalls(f: Filters): Promise<ApiCallRow[]> {
  const itv = PERIODS[f.period].interval;
  return q<ApiCallRow>(
    `select regexp_replace(coalesce(f.url, ''), '^https?://[^/]+', '') as url,
            f.method,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by f.duration_ms) as front_p75,
            percentile_cont(0.75) within group (order by b.duration_ms)
              filter (where b.duration_ms is not null) as back_p75,
            count(*) filter (where coalesce(f.status_code, 0) >= 400
                                or coalesce(f.status_code, 0) = 0)::int as err
     from rum_span f
     left join rum_span b on b.trace_id = f.trace_id and b.tier = 'back'
     left join rum_session s on s.session_id = f.session_id
     where f.tier = 'front' and f.ts > now() - interval '${itv}'
       and ($1::text is null or f.app_id = $1)
       and ($2::text is null or s.device_type = $2)
     group by 1, 2
     order by front_p75 desc nulls last
     limit 50`,
    [f.app, f.device],
  );
}

export interface BackRouteRow {
  route: string;
  n: number;
  p75: number;
  p95: number;
  err: number;
}

/** Routes backend (templates FastAPI), tout trafic confondu — la vue « serveur ». */
export async function backRoutes(f: Filters): Promise<BackRouteRow[]> {
  const itv = PERIODS[f.period].interval;
  return q<BackRouteRow>(
    `select coalesce(route, '—') as route,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by duration_ms) as p75,
            percentile_cont(0.95) within group (order by duration_ms) as p95,
            count(*) filter (where coalesce(status_code, 0) >= 500)::int as err
     from rum_span
     where tier = 'back' and ts > now() - interval '${itv}'
       and ($1::text is null or app_id = $1)
     group by 1
     order by p75 desc nulls last
     limit 50`,
    [f.app],
  );
}

export interface SlowTrace {
  trace_id: string;
  session_id: string | null;
  url: string;
  method: string;
  front_status: number | null;
  front_ms: number;
  back_ms: number | null;
  network_ms: number | null;
  ts: Date;
}

export interface TraceSpanRow {
  span_id: string;
  parent_span_id: string | null;
  tier: "front" | "back" | "detail";
  name: string | null;
  kind: string | null;
  route: string | null;
  url: string | null;
  method: string | null;
  status_code: number | null;
  duration_ms: number;
  ts: Date;
  app_id: string;
  session_id: string | null;
}

/**
 * Tous les spans d'une trace (front + back + detail), ordonnés par début — la
 * matière du waterfall « douleur utilisateur → cause backend ». `ts` porte le
 * début de span (nanosToDate à l'ingestion), donc les offsets se calculent par
 * différence côté rendu.
 *
 * `opts.apps` restreint aux apps autorisées ET demandées (P5.1) : un trace_id est
 * émis par le client, deux tenants peuvent donc le partager, et un lien depuis
 * une erreur de l'app A ne doit jamais montrer les spans de B. `null` = aucune
 * restriction ; `[]` = aucune app, donc aucun span.
 */
export async function traceSpans(
  traceId: string,
  opts?: { apps?: string[] | null },
): Promise<TraceSpanRow[]> {
  return q<TraceSpanRow>(
    `select span_id, parent_span_id, tier, name, kind, route, url, method,
            status_code, duration_ms, ts, app_id, session_id
       from rum_span
      where trace_id = $1
        and ($2::text[] is null or app_id = any($2::text[]))
      order by ts asc, case tier when 'front' then 0 when 'back' then 1 else 2 end`,
    [traceId, opts?.apps ?? null],
  );
}

/** Les appels les plus lents de la fenêtre, décomposés front / serveur / réseau. */
export async function slowTraces(f: Filters): Promise<SlowTrace[]> {
  const itv = PERIODS[f.period].interval;
  return q<SlowTrace>(
    `select t.trace_id, t.session_id,
            regexp_replace(coalesce(t.url, ''), '^https?://[^/]+', '') as url,
            t.method, t.front_status, t.front_ms, t.back_ms, t.network_ms, t.ts
     from v_trace t
     left join rum_session s on s.session_id = t.session_id
     where t.ts > now() - interval '${itv}'
       and ($1::text is null or t.app_id = $1)
       and ($2::text is null or s.device_type = $2)
     order by t.front_ms desc
     limit 20`,
    [f.app, f.device],
  );
}
