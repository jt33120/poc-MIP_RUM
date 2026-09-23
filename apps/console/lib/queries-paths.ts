// Analyse de parcours — couche I/O (transitions, entrées, sorties). Reflète la
// définition pure de lib/paths.ts à l'échelle SQL, sur rum_pageview (séquence de
// routes par session, ordonnée par started_at).
//
// B31 (plan § 6.3) : sur le contrat. Chaque lecture passe par `sqlContext(f)` —
// fenêtre `[from, to)`, apps EFFECTIVES du principal (jamais « l'app demandée, ou
// toutes si elle est nulle »), conditions et bots compilés — avec UN contexte par
// instruction (ses paramètres liés ne servent qu'à elle). Une session est désignée
// par `(app_id, session_id)` : l'identifiant est émis par le client, deux apps
// peuvent le partager. Les boucles A→A (recharges, SPA) sont retirées par
// `next_route <> route` — équivalent à collapseRepeats + count.
import { q } from "./db";
import type { FiltersLike } from "./filters";
import { sessionJoin } from "./query-compiler";
import { previousRange } from "./query-contract";
import { sqlContext, type SqlContext } from "./query-sql";

export interface TransitionRow {
  from_route: string;
  to_route: string;
  n: number;
}

/** Prédicats des vues lues (fenêtre, périmètre, conditions, bots), période précédente comprise. */
function vuesLues(sql: SqlContext, shift: boolean): string {
  return sql.where({
    dataset: "views",
    row: "p",
    session: "s",
    time: "p.started_at",
    ...(shift ? { range: previousRange(sql.query.range) } : {}),
  });
}

/**
 * Transitions route→route les plus fréquentes (hors boucles), top `limit`.
 *
 * `depuis` (B31, ancrage « à partir de », § 5.13.4) : seules les transitions qui
 * PARTENT de cette route — valeur liée, jamais interpolée. La séquence est calculée
 * sur toutes les vues de la session avant le filtre : ancrer ne change pas la route
 * qui suit. `shift` : la même lecture sur la période précédente contiguë.
 */
export async function routeTransitions(
  f: FiltersLike,
  limit = 50,
  options: { depuis?: string | null; shift?: boolean } = {},
): Promise<TransitionRow[]> {
  const sql = await sqlContext(f);
  const where = vuesLues(sql, options.shift === true);
  const depuis = options.depuis ? ` and route = ${sql.bind(options.depuis)}` : "";
  const limite = sql.bind(limit);
  return q<TransitionRow>(
    `with pv as (
       select p.route,
              lead(p.route) over (partition by p.app_id, p.session_id order by p.started_at, p.id) as next_route
         from rum_pageview p
         ${sessionJoin("p", "s")}
        where p.session_id is not null${where}
     )
     select route as from_route, next_route as to_route, count(*)::int as n
       from pv
      where next_route is not null and next_route <> route${depuis}
      group by route, next_route
      order by n desc, from_route, to_route
      limit ${limite}`,
    sql.params,
  );
}

export interface RouteCountRow {
  route: string;
  /** Sessions dont c'est la 1re (ou la dernière) route sur la fenêtre. */
  n: number;
  /** Parmi elles, sessions à UNE seule vue sur la fenêtre (entrée = sortie). */
  une_vue: number;
}

/** Pages d'entrée (1re route de chaque session) et de sortie (dernière), top `limit`. */
export async function entryExitRoutes(
  f: FiltersLike,
  limit = 15,
): Promise<{ entries: RouteCountRow[]; exits: RouteCountRow[] }> {
  const [entries, exits] = await Promise.all([boundaryRoutes(f, "asc", limit), boundaryRoutes(f, "desc", limit)]);
  return { entries, exits };
}

/** Route de bord de session : 1re (asc) ou dernière (desc) par session, agrégée. */
async function boundaryRoutes(f: FiltersLike, dir: "asc" | "desc", limit: number): Promise<RouteCountRow[]> {
  const sql = await sqlContext(f);
  const where = vuesLues(sql, false);
  const limite = sql.bind(limit);
  // `dir` est une constante littérale côté code (jamais une entrée utilisateur).
  const order = dir === "asc" ? "asc" : "desc";
  return q<RouteCountRow>(
    `with vues as (
       select p.app_id, p.session_id, p.route, p.started_at, p.id,
              count(*) over (partition by p.app_id, p.session_id) as nb
         from rum_pageview p
         ${sessionJoin("p", "s")}
        where p.session_id is not null${where}
     ),
     bords as (
       select distinct on (app_id, session_id) route, nb
         from vues
        order by app_id, session_id, started_at ${order}, id ${order}
     )
     select route, count(*)::int as n, (count(*) filter (where nb = 1))::int as une_vue
       from bords
      group by route
      order by n desc, route
      limit ${limite}`,
    sql.params,
  );
}

export interface LcpDeRoute {
  route: string;
  /** p75 du LCP des mesures de la route sur la fenêtre ; null sans mesure (V3). */
  p75: number | null;
  /** Mesures LCP lues : l'effectif du p75. */
  n: number;
}

/**
 * LCP p75 de quelques routes (colonne « LCP p75 de la route » des tables de
 * bords, § 5.13.4), sur la MÊME fenêtre et les mêmes filtres que les bords — ce
 * que S2 interdisait avant B31. Routes liées en tableau, jamais interpolées ; une
 * route sans mesure est absente du résultat.
 */
export async function lcpDesRoutes(f: FiltersLike, routes: readonly string[]): Promise<LcpDeRoute[]> {
  if (!routes.length) return [];
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const liste = sql.bind([...routes]);
  return q<LcpDeRoute>(
    `select m.route,
            (percentile_cont(0.75) within group (order by m.value))::float8 as p75,
            count(*)::int as n
       from rum_metric m
       ${sessionJoin("m", "s")}
      where m.name = 'LCP' and m.route = any(${liste}::text[])${where}
      group by m.route`,
    sql.params,
  );
}
