// Couche de données « Carte d'expérience ». Lecture seule sur rum_span (front/back,
// corrélés par trace_id) et rum_metric (pages). Aucune ingestion spécifique : on
// réexploite le graphe de service déjà capté par le tracing distribué. Plage,
// périmètre, route et dimensions de session viennent du contrat commun (P6.2).
import { q } from "./db";
import { type FiltersLike } from "./filters";
import { sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";

export interface MapNodeRow {
  tier: "front" | "back";
  route: string;
  calls: number;
  latency_p75: number | null;
  error_rate: number;
  recent: number; // appels sur la moitié récente de la plage
  older: number; // appels sur la moitié ancienne
}

/** Nœuds du graphe : routes front (API vues du navigateur) et back (serveur),
 * avec volume, latence p75, taux d'erreur et split récent/ancien (tendance). */
export async function mapNodes(f: FiltersLike): Promise<MapNodeRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "sp", session: "s", time: "sp.ts" });
  // Milieu de la plage résolue : la tendance compare ses deux moitiés, pas « maintenant ».
  const { from, to } = sql.query.range;
  const milieu = sql.bind(new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString());
  return q<MapNodeRow>(
    `select
       sp.tier,
       sp.route,
       count(*)::int as calls,
       percentile_cont(0.75) within group (order by sp.duration_ms)::float8 as latency_p75,
       (count(*) filter (where sp.status_code >= 400)::float8 / nullif(count(*), 0))::float8 as error_rate,
       count(*) filter (where sp.ts >= ${milieu}::timestamptz)::int as recent,
       count(*) filter (where sp.ts < ${milieu}::timestamptz)::int as older
     from rum_span sp
     ${sessionJoin("sp", "s")}
     where sp.route is not null${where}
     group by sp.tier, sp.route
     order by count(*) desc
     limit 40`,
    sql.params,
  );
}

export interface MapEdgeRow {
  front_route: string;
  back_route: string;
  calls: number;
}

/** Arêtes front→back : appels navigateur reliés à leur exécution serveur (même trace, même app). */
export async function mapEdges(f: FiltersLike): Promise<MapEdgeRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  return q<MapEdgeRow>(
    `select fr.route as front_route, b.route as back_route, count(*)::int as calls
     from rum_span fr
     ${sessionJoin("fr", "s")}
     join rum_span b on b.app_id = fr.app_id and b.trace_id = fr.trace_id and b.tier = 'back'
     where fr.tier = 'front'
       and fr.route is not null and b.route is not null${where}
     group by 1, 2
     order by count(*) desc
     limit 80`,
    sql.params,
  );
}

export interface MapPageRow {
  route: string;
  sessions: number;
  lcp_p75: number | null;
}

/** Pages d'entrée : top routes par sessions, avec leur LCP p75 (contexte parcours). */
export async function mapPages(f: FiltersLike): Promise<MapPageRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  return q<MapPageRow>(
    `select
       m.route,
       count(distinct m.session_id)::int as sessions,
       (percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP'))::float8 as lcp_p75
     from rum_metric m
     ${sessionJoin("m", "s")}
     where m.route is not null${where}
     group by m.route
     order by count(distinct m.session_id) desc
     limit 12`,
    sql.params,
  );
}
