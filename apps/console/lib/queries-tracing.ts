// Requêtes /tracing (v0.4) — corrélation front↔back par trace_id (rum_span).
// Contrat commun P6.2 : plage [from,to), périmètre d'apps, route, dimensions de
// session et bots compilés en paramètres liés. Le jumeau backend est cherché DANS
// LA MÊME APP : un trace_id est émis par le client, deux tenants peuvent le partager.
import { q } from "./db";
import { type FiltersLike } from "./filters";
import { sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";

export interface TraceCoverage {
  total: number; // appels API vus du navigateur (spans front)
  correlated: number; // dont jumeau backend trouvé (même trace_id, même app)
  back_total: number; // spans back reçus (inclut le trafic sans front : robots, curl)
  front_p75: number | null;
  back_p75: number | null;
}

const JUMEAU_BACK = "left join rum_span b on b.app_id = fr.app_id and b.trace_id = fr.trace_id and b.tier = 'back'";

export async function traceCoverage(f: FiltersLike): Promise<TraceCoverage> {
  const sql = await sqlContext(f);
  const front = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  const back = sql.where({ dataset: "spans", row: "bk", session: "bs", time: "bk.ts" });
  const [row] = await q<TraceCoverage>(
    `select
       count(*) filter (where fr.tier = 'front')::int as total,
       count(b.span_id)::int as correlated,
       (select count(*)::int from rum_span bk
         ${sessionJoin("bk", "bs")}
         where bk.tier = 'back'${back}) as back_total,
       percentile_cont(0.75) within group (order by fr.duration_ms) as front_p75,
       percentile_cont(0.75) within group (order by b.duration_ms) as back_p75
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${front}`,
    sql.params,
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
export async function apiCalls(f: FiltersLike): Promise<ApiCallRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  return q<ApiCallRow>(
    `select regexp_replace(coalesce(fr.url, ''), '^https?://[^/]+', '') as url,
            fr.method,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by fr.duration_ms) as front_p75,
            percentile_cont(0.75) within group (order by b.duration_ms)
              filter (where b.duration_ms is not null) as back_p75,
            count(*) filter (where coalesce(fr.status_code, 0) >= 400
                                or coalesce(fr.status_code, 0) = 0)::int as err
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${where}
     group by 1, 2
     order by front_p75 desc nulls last
     limit 50`,
    sql.params,
  );
}

export interface BackRouteRow {
  route: string;
  n: number;
  p75: number;
  p95: number;
  err: number;
}

/** Routes backend (templates FastAPI) — la vue « serveur » ; un filtre de session écarte le trafic sans session. */
export async function backRoutes(f: FiltersLike): Promise<BackRouteRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "bk", session: "s", time: "bk.ts" });
  return q<BackRouteRow>(
    `select coalesce(bk.route, '—') as route,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by bk.duration_ms) as p75,
            percentile_cont(0.95) within group (order by bk.duration_ms) as p95,
            count(*) filter (where coalesce(bk.status_code, 0) >= 500)::int as err
     from rum_span bk
     ${sessionJoin("bk", "s")}
     where bk.tier = 'back'${where}
     group by 1
     order by p75 desc nulls last
     limit 50`,
    sql.params,
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

/** Les appels les plus lents de la plage, décomposés front / serveur / réseau. */
export async function slowTraces(f: FiltersLike): Promise<SlowTrace[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  return q<SlowTrace>(
    `select fr.trace_id, fr.session_id,
            regexp_replace(coalesce(fr.url, ''), '^https?://[^/]+', '') as url,
            fr.method, fr.status_code as front_status, fr.duration_ms as front_ms,
            b.duration_ms as back_ms,
            case when b.duration_ms is not null then greatest(fr.duration_ms - b.duration_ms, 0) end as network_ms,
            fr.ts
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${where}
     order by fr.duration_ms desc
     limit 20`,
    sql.params,
  );
}
