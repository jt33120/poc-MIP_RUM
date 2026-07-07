// Couche de données « Carte d'expérience ». Lecture seule sur rum_span (front/back,
// corrélés par trace_id) et rum_metric (pages). Aucune ingestion spécifique : on
// réexploite le graphe de service déjà capté par le tracing distribué.
import { q } from "./db";
import { type Filters, periodInterval } from "./queries-v2";

const APP = (f: Filters) => (f.app === "all" ? "all" : f.app);

export interface MapNodeRow {
  tier: "front" | "back";
  route: string;
  calls: number;
  latency_p75: number | null;
  error_rate: number;
  recent: number; // appels sur la moitié récente de la fenêtre
  older: number; // appels sur la moitié ancienne
}

/** Nœuds du graphe : routes front (API vues du navigateur) et back (serveur),
 * avec volume, latence p75, taux d'erreur et split récent/ancien (tendance). */
export async function mapNodes(f: Filters): Promise<MapNodeRow[]> {
  return q<MapNodeRow>(
    `select
       tier,
       route,
       count(*)::int as calls,
       percentile_cont(0.75) within group (order by duration_ms)::float8 as latency_p75,
       (count(*) filter (where status_code >= 400)::float8 / nullif(count(*), 0))::float8 as error_rate,
       count(*) filter (where ts > now() - ($2::interval) / 2)::int as recent,
       count(*) filter (where ts <= now() - ($2::interval) / 2)::int as older
     from rum_span
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
       and route is not null
     group by tier, route
     order by count(*) desc
     limit 40`,
    [APP(f), periodInterval(f)],
  );
}

export interface MapEdgeRow {
  front_route: string;
  back_route: string;
  calls: number;
}

/** Arêtes front→back : appels navigateur reliés à leur exécution serveur (même trace_id). */
export async function mapEdges(f: Filters): Promise<MapEdgeRow[]> {
  return q<MapEdgeRow>(
    `select f.route as front_route, b.route as back_route, count(*)::int as calls
     from rum_span f
     join rum_span b on b.trace_id = f.trace_id and b.tier = 'back'
     where f.tier = 'front'
       and ($1 = 'all' or f.app_id = $1)
       and f.ts > now() - $2::interval
       and f.route is not null and b.route is not null
     group by 1, 2
     order by count(*) desc
     limit 80`,
    [APP(f), periodInterval(f)],
  );
}

export interface MapPageRow {
  route: string;
  sessions: number;
  lcp_p75: number | null;
}

/** Pages d'entrée : top routes par sessions, avec leur LCP p75 (contexte parcours). */
export async function mapPages(f: Filters): Promise<MapPageRow[]> {
  return q<MapPageRow>(
    `select
       route,
       count(distinct session_id)::int as sessions,
       (percentile_cont(0.75) within group (order by value) filter (where name = 'LCP'))::float8 as lcp_p75
     from rum_metric
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
       and route is not null
     group by route
     order by count(distinct session_id) desc
     limit 12`,
    [APP(f), periodInterval(f)],
  );
}
