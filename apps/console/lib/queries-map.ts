// Couche de données « Carte d'expérience ». Lecture seule sur rum_span (front/back,
// corrélés par trace_id) et rum_metric (pages). Aucune ingestion spécifique : on
// réexploite le graphe de service déjà capté par le tracing distribué. Plage,
// périmètre, route et dimensions de session viennent du contrat commun (P6.2).
import { q } from "./db";
import { type FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql, sessionJoin } from "./query-compiler";
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

/**
 * Arêtes front→back : UN appel navigateur relié à SON exécution serveur — même app,
 * même trace, et surtout le span serveur dont le parent est cet appel
 * (`b.parent_span_id = fr.span_id`).
 *
 * POURQUOI LE PARENT (même correction que F60 sur `/tracing`, `JUMEAU_BACK`).
 * Depuis E0, tous les appels d'une page vue partagent le `trace_id` de la vue
 * (`packages/rum-sdk/src/index.ts`, `traceId: currentTraceId`) ; chaque appel garde
 * son `spanId` dans `traceparent`, que le middleware serveur recopie en
 * `parent_span_id` de son span (`packages/backend/…/otlp.mjs`). Joindre par `trace_id`
 * SEUL faisait donc le produit cartésien des appels et des réponses d'une même
 * trace : une vue à trois appels et trois réponses pesait neuf arêtes au lieu de
 * trois. Pire, le `route` d'un span front est la route de la page AU MOMENT DE
 * L'ÉMISSION (`mip.route = currentRoute()`, émis à la fin de l'appel) : un appel
 * lancé sur `/panier` et rendu après une navigation SPA porte `/paiement` tout en
 * gardant la trace de `/panier`. La réponse serveur de l'appel de `/panier` était
 * alors rattachée à la vue `/paiement`, et la carte dessinait un lien qui n'a
 * jamais existé. Le parent tranche : une réponse serveur n'appartient qu'à l'appel
 * qui l'a déclenchée, donc qu'à la vue de CET appel.
 *
 * Limite (identique à F60) : un proxy instrumenté qui s'intercalerait rendrait
 * l'appel « non corrélé » plutôt que mal corrélé — une arête manquante, jamais une
 * arête fausse. Et une trace à deux spans serveur enfants du même appel compte
 * bien deux arêtes (méta de l'écran, § 5.10.4).
 */
export async function mapEdges(f: FiltersLike): Promise<MapEdgeRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  return q<MapEdgeRow>(
    `select fr.route as front_route, b.route as back_route, count(*)::int as calls
     from rum_span fr
     ${sessionJoin("fr", "s")}
     join rum_span b
       on b.app_id = fr.app_id and b.trace_id = fr.trace_id and b.tier = 'back'
      and b.parent_span_id = fr.span_id
     where fr.tier = 'front'
       and fr.route is not null and b.route is not null${where}
     group by 1, 2
     order by count(*) desc
     limit 80`,
    sql.params,
  );
}

export interface MapNodePoint {
  /** Début du seau, ISO UTC. */
  t: string;
  /** Latence p75 des appels du seau ; `null` = aucun appel (un trou, jamais 0 ms). */
  p75: number | null;
  /** Appels du seau — additif : un seau sans appel vaut 0. */
  appels: number;
}

/**
 * B37 — série de latence et de volume d'UN nœud de la carte (panneau nœud, M6).
 *
 * Tous les seaux de `[from, to)` sont rendus (grille du contrat, § 3.10) : un seau
 * sans appel garde `appels: 0` (compte additif) et `p75: null` (une latence absente
 * n'est pas 0 ms, V3). Le nœud est désigné par son couple (tier, route), celui-là
 * même que `mapNodes` agrège et que `panel=noeud:<tier>:<route>` transporte.
 */
export async function mapNodeSerie(f: FiltersLike, tier: "front" | "back", route: string): Promise<MapNodePoint[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "sp", session: "s", time: "sp.ts" });
  const serie = bucketSeriesSql(sql.query.range, sql.bind);
  const lignes = await q<Omit<MapNodePoint, "t"> & { t: Date }>(
    `with agrege as (
       select ${bucketExpr("sp.ts", sql.query.range)} as t,
              percentile_cont(0.75) within group (order by sp.duration_ms)::float8 as p75,
              count(*)::int as appels
         from rum_span sp
         ${sessionJoin("sp", "s")}
        where sp.tier = ${sql.bind(tier)} and sp.route = ${sql.bind(route)}${where}
        group by 1
     )
     select seau.t, a.p75, coalesce(a.appels, 0)::int as appels
       from ${serie} as seau(t)
       left join agrege a on a.t = seau.t
      order by 1`,
    sql.params,
  );
  // timestamptz → Date par node-postgres : l'instant est exact, l'ISO est UTC.
  return lignes.map((l) => ({ ...l, t: l.t.toISOString() }));
}

export interface MapPageRow {
  route: string;
  sessions: number;
  lcp_p75: number | null;
}

/**
 * Pages LES PLUS VISITÉES : top 12 routes par sessions mesurées, avec leur LCP p75.
 *
 * Le libellé « Pages d'entrée » d'avant F52 était faux : rien ici ne dit qu'une
 * route a OUVERT la session (l'entrée se lit sur `rum_pageview.referrer`, écran
 * Acquisition). Ce sont les routes les plus MESURÉES de la fenêtre.
 */
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
