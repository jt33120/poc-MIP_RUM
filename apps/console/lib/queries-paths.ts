// Analyse de parcours — couche I/O (transitions, entrées, sorties). Reflète la
// définition pure de lib/paths.ts à l'échelle SQL, sur rum_pageview (séquence de
// routes par session, ordonnée par started_at).
//
// Convention identique aux requêtes cœur : $1 = app (null = toutes), $2 = device
// (null = tous), segment à partir de $3 ; intervalle depuis PERIODS (constantes).
// Bots exclus par défaut (rum_session.is_bot). Les boucles A→A (recharges/SPA)
// sont retirées via `next_route <> route` — équivalent à collapseRepeats+count.
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";
import { buildSegment } from "./segments";

const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

export interface TransitionRow {
  from_route: string;
  to_route: string;
  n: number;
}

/** Transitions route→route les plus fréquentes (hors boucles), top `limit`. */
export async function routeTransitions(f: Filters, limit = 50): Promise<TransitionRow[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 4);
  return q<TransitionRow>(
    `with pv as (
       select p.route,
              lead(p.route) over (partition by p.session_id order by p.started_at, p.id) as next_route
       from rum_pageview p
       join rum_session s on s.session_id = p.session_id
       where p.started_at > now() - interval '${itv}'
         and ($1::text is null or p.app_id = $1)
         and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     )
     select route as from_route, next_route as to_route, count(*)::int as n
     from pv
     where next_route is not null and next_route <> route
     group by route, next_route
     order by n desc, from_route, to_route
     limit $3`,
    [f.app, f.device, limit, ...seg.params],
  );
}

export interface RouteCountRow {
  route: string;
  n: number;
}

/** Pages d'entrée (1re route de chaque session) et de sortie (dernière), top `limit`. */
export async function entryExitRoutes(
  f: Filters,
  limit = 15,
): Promise<{ entries: RouteCountRow[]; exits: RouteCountRow[] }> {
  const [entries, exits] = await Promise.all([
    boundaryRoutes(f, "asc", limit),
    boundaryRoutes(f, "desc", limit),
  ]);
  return { entries, exits };
}

/** Route de bord de session : 1re (asc) ou dernière (desc) par session, agrégée. */
async function boundaryRoutes(
  f: Filters,
  dir: "asc" | "desc",
  limit: number,
): Promise<RouteCountRow[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 4);
  // `dir` est une constante littérale côté code (jamais une entrée utilisateur).
  const order = dir === "asc" ? "asc" : "desc";
  return q<RouteCountRow>(
    `with firsts as (
       select distinct on (p.session_id) p.route
       from rum_pageview p
       join rum_session s on s.session_id = p.session_id
       where p.started_at > now() - interval '${itv}'
         and ($1::text is null or p.app_id = $1)
         and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
       order by p.session_id, p.started_at ${order}, p.id ${order}
     )
     select route, count(*)::int as n
     from firsts
     group by route
     order by n desc, route
     limit $3`,
    [f.app, f.device, limit, ...seg.params],
  );
}
