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

// Exclut les apps internes (dogfooding : la console qui se mesure elle-même) de la
// vue « toutes apps ». Quand une app précise est sélectionnée, AUCUNE exclusion —
// l'app interne reste consultable. N'ajoute aucun paramètre (sous-requête pure),
// donc composable dans toutes les requêtes sans décaler l'indexation $n.
export const internalClause = (f: Pick<Filters, "app" | "includeInternal">, appCol: string): string =>
  f.app || f.includeInternal
    ? ""
    : ` and ${appCol} not in (select app_id from app_registry where internal)`;

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
  p50: number; // médiane — plus robuste que le p75 sur petit échantillon
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
            percentile_cont(0.5) within group (order by m.value) as p50,
            count(*)::int as n
     from rum_metric m
     left join rum_session s using (session_id)
     where ${window}
       and ($1::text is null or m.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "m.app_id")}
     group by m.name`,
    [f.app, f.device, ...seg.params],
  );
}

export interface VitalPercentiles {
  name: string;
  pcts: number[]; // [p50, p75, p90, p95, p99] (percentile_cont array, ordre PCTS)
  n: number;
}

/** p50/p75/p90/p95/p99 par vital — la distribution que le seul p75 masque. */
export async function vitalPercentiles(f: Filters): Promise<VitalPercentiles[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  return q<VitalPercentiles>(
    `select m.name,
            percentile_cont(array[0.5,0.75,0.9,0.95,0.99]) within group (order by m.value) as pcts,
            count(*)::int as n
     from rum_metric m
     left join rum_session s using (session_id)
     where m.ts > now() - interval '${itv}'
       and ($1::text is null or m.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     group by m.name`,
    [f.app, f.device, ...seg.params],
  );
}

export interface HistoRow {
  bucket: number;
  count: number;
}

/** Histogramme d'un vital sur [0, cap] en `nbuckets` tranches (width_bucket). */
export async function vitalHistogram(
  f: Filters,
  name: string,
  cap: number,
  nbuckets: number,
): Promise<HistoRow[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 6);
  return q<HistoRow>(
    `select width_bucket(m.value, 0, $4::float, $5::int) as bucket, count(*)::int as count
     from rum_metric m
     left join rum_session s using (session_id)
     where m.name = $3 and m.ts > now() - interval '${itv}'
       and ($1::text is null or m.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     group by 1 order by 1`,
    [f.app, f.device, name, cap, nbuckets, ...seg.params],
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
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "s.app_id")}) as sessions,
       (select coalesce(sum(e.occurrences), 0)::int from rum_error e
         left join rum_session s using (session_id)
         where ${win("e.ts")}
           and ($1::text is null or e.app_id = $1)
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "e.app_id")}) as errors,
       (select count(*)::int from rum_pageview p
         left join rum_session s using (session_id)
         where ${win("p.started_at")}
           and ($1::text is null or p.app_id = $1)
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "p.app_id")}) as pageviews`,
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
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "m.app_id")}
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

/**
 * Nombre maximal de routes rendues. Au-delà, l'écran n'est plus lisible : une
 * statistique par page, donc aucune statistique.
 */
export const ROUTES_MAX = 200;

/**
 * Routes les plus lentes, par p75 LCP.
 *
 * ─────────────────────── CE QUI ÉTAIT EN PLACE ───────────────────────────────
 *
 * Finding 2.6 de docs/AUDIT_RUM_EXTERNE.md. Un `group by m.route` SANS `LIMIT`,
 * et chaque ligne déclenchait DEUX sous-requêtes corrélées — l'une comptant les
 * pages vues, l'autre les tâches longues. Sur un catalogue de 20 000 URL
 * distinctes, cela fait 40 000 sous-requêtes et 20 000 lignes rendues en HTML.
 *
 * Et la cardinalité de `route` n'est bornée par rien : `normalizeRoute` ne
 * couvre que les entiers, les UUID et les hexadécimaux longs. Ni les slugs, ni
 * les dates, ni les identifiants alphanumériques courts. Un site e-commerce ou
 * un portail de recherche fait exploser la dimension en quelques heures.
 *
 * ─────────────────────────── CE QU'ON FAIT ───────────────────────────────────
 *
 * Les deux sous-requêtes corrélées deviennent des CTE agrégées, calculées UNE
 * fois puis jointes : le coût cesse de dépendre du nombre de routes. Et la
 * liste est bornée à `ROUTES_MAX`, en gardant les PLUS LENTES — celles qu'on est
 * venu chercher.
 *
 * LE PLAFOND EST VISIBLE, pas silencieux : `tronque` dit à l'écran qu'il ne
 * montre pas tout. Une liste coupée sans le dire ferait croire à un catalogue
 * plus petit qu'il n'est, ce qui est exactement le genre de silence que ce
 * dépôt corrige ailleurs.
 */
export async function slowRoutes(f: Filters): Promise<RouteRow[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  return q<RouteRow>(
    `with vues as (
       select p.route, count(*)::int as views
         from rum_pageview p
         left join rum_session ps using (session_id)
        where p.started_at > now() - interval '${itv}' and p.route is not null
          and ($1::text is null or p.app_id = $1)
          and ($2::text is null or ps.device_type = $2)${seg.where("ps")}${botClause(f, "ps")}
        group by p.route
     ),
     taches as (
       select l.route, count(*)::int as longtasks
         from rum_longtask l
         left join rum_session ls using (session_id)
        where l.ts > now() - interval '${itv}' and l.route is not null
          and ($1::text is null or l.app_id = $1)
          and ($2::text is null or ls.device_type = $2)${seg.where("ls")}${botClause(f, "ls")}
        group by l.route
     ),
     vitals as (
       select m.route,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as lcp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as inp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'CLS') as cls_p75
         from rum_metric m
         left join rum_session s using (session_id)
        where m.ts > now() - interval '${itv}' and m.route is not null
          and ($1::text is null or m.app_id = $1)
          and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "m.app_id")}
        group by m.route
     )
     select v.route,
            coalesce(vues.views, 0) as views,
            v.lcp_p75, v.inp_p75, v.cls_p75,
            coalesce(taches.longtasks, 0) as longtasks
       from vitals v
       left join vues   on vues.route   = v.route
       left join taches on taches.route = v.route
      order by v.lcp_p75 desc nulls last
      limit ${ROUTES_MAX}`,
    [f.app, f.device, ...seg.params],
  );
}

/**
 * Routes DISTINCTES vues sur la fenêtre. Sert à dire si la liste ci-dessus est
 * tronquée, et à faire remonter une explosion de cardinalité avant qu'elle ne
 * rende l'écran inutile.
 */
export async function nombreDeRoutes(f: Filters): Promise<number> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  const [r] = await q<{ n: number }>(
    `select count(distinct m.route)::int as n
       from rum_metric m
       left join rum_session s using (session_id)
      where m.ts > now() - interval '${itv}' and m.route is not null
        and ($1::text is null or m.app_id = $1)
        and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}${internalClause(f, "m.app_id")}`,
    [f.app, f.device, ...seg.params],
  );
  return r?.n ?? 0;
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
  collection_source: string | null; // 'sdk' (défaut) | 'extension'
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
       select coalesce(sum(occurrences), 0)::int as err_count
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
  /** Identifiant de visiteur (tirage aléatoire du SDK). NULL avant le 09/09/2026. */
  visitor_id: string | null;
  /** Colonne GÉNÉRÉE : 'random' si visitor_id, 'device_class' sinon (migration-v57). */
  id_kind: string | null;
  /** ANCIENNE empreinte de classe d'appareil — n'identifie pas une personne. */
  user_hash: string | null;
  user_agent: string | null;
  device_type: string | null;
  geo_country: string | null;
  started_at: Date;
  last_seen_at: Date;
  page_count: number;
  collection_source: string | null; // 'sdk' (défaut) | 'extension'
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
  | "action"
  | "resource"
  | "api";

export interface TimelineItem {
  kind: TimelineKind;
  ts: Date;
  title: string | null; // route | nom du vital | type d'erreur | type de crumb | nom d'event
  detail: string | null; // nav_type | route | message | label | props
  value: number | null; // valeur vital | seq | duration_ms
  rating: string | null; // good|needs-improvement|poor (vitals)
  action_id: string | null;
  action_name: string | null;
}

/** Timeline fusionnée chronologique d'une session (toutes tables v0.1 + v0.2). */
export async function sessionTimeline(id: string): Promise<TimelineItem[]> {
  const [schema] = await q<{ v67: boolean }>(
    "select to_regclass('public.rum_action') is not null as v67",
  );
  if (schema?.v67) {
    return q<TimelineItem>(
      `select t.kind, t.ts, t.title, t.detail, t.value, t.rating,
              case when t.kind = 'action' then t.action_id else a.action_id end as action_id,
              coalesce(t.action_name, a.name) as action_name
         from (
           select 'pageview' as kind, started_at as ts, route as title, nav_type as detail,
                  null::float as value, null::text as rating, null::text as action_id, null::text as action_name,
                  app_id
           from rum_pageview where session_id = $1
           union all
           select 'vital', ts, name, route, value, rating, null, null, app_id
           from rum_metric where session_id = $1
           union all
           select 'action', ts, name, type || coalesce(' · ' || route, ''), null, null, action_id, name, app_id
           from rum_action where session_id = $1
           union all
           select 'error', ts, coalesce(error_type, kind), message, null, null, action_id, null, app_id
           from rum_error where session_id = $1
           union all
           select 'breadcrumb', ts, type, label, seq::float, null, action_id, null, app_id
           from rum_breadcrumb where session_id = $1
           union all
           select 'resource', ts, coalesce(type, 'resource'), url, duration_ms, null, action_id, null, app_id
           from rum_resource where session_id = $1 and action_id is not null
           union all
           select 'longtask', ts,
                  case when script_function is not null and script_function <> ''
                            then 'Blocage · ' || script_function
                       when invoker is not null and invoker <> ''
                            then 'Blocage · ' || invoker
                       else 'Long task' end,
                  coalesce(route, '') || coalesce(' · ' || regexp_replace(script_url, '^https?://', ''), ''),
                  coalesce(blocking_ms, duration_ms), null, null, null, app_id
           from rum_longtask where session_id = $1
           union all
           select 'event', ts, name, props::text, null, null, action_id, null, app_id
           from rum_event where session_id = $1 and event_type is distinct from 'action'
           union all
           select 'api', f.ts,
                  f.method || ' ' || regexp_replace(coalesce(f.url, ''), '^https?://[^/]+', ''),
                  coalesce(f.status_code::text, '—')
                    || coalesce(' · serveur ' || round(b.duration_ms::numeric) || ' ms', ''),
                  f.duration_ms,
                  case when coalesce(f.status_code, 0) >= 400 or coalesce(f.status_code, 0) = 0
                       then 'poor' end,
                  f.action_id, null, f.app_id
           from rum_span f
           left join lateral (
             select child.duration_ms
               from rum_span child
              where child.trace_id = f.trace_id and child.tier = 'back'
                and child.parent_span_id = f.span_id
              order by child.ts asc, child.id asc
              limit 1
           ) b on true
           where f.session_id = $1 and f.tier = 'front'
         ) t
         left join rum_action a
           on a.action_id = t.action_id and a.app_id = t.app_id and a.session_id = $1
        order by t.ts asc, case when t.kind = 'action' then 0 else 1 end, t.kind
        limit 500`,
      [id],
    );
  }
  return q<TimelineItem>(
    `select kind, ts, title, detail, value, rating,
            null::text as action_id, null::text as action_name from (
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
       -- Le libellé porte l'ATTRIBUTION quand on l'a (Long Animation Frames) :
       -- « Blocage · recalculerTotal » vaut mieux que « Long task » répété
       -- douze fois. Le détail garde la route, et lui adjoint le script.
       select 'longtask', ts,
              case when script_function is not null and script_function <> ''
                        then 'Blocage · ' || script_function
                   when invoker is not null and invoker <> ''
                        then 'Blocage · ' || invoker
                   else 'Long task' end,
              coalesce(route, '') ||
                coalesce(' · ' || regexp_replace(script_url, '^https?://', ''), ''),
              coalesce(blocking_ms, duration_ms), null
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
       left join lateral (
         select child.duration_ms
           from rum_span child
          where child.trace_id = f.trace_id and child.tier = 'back'
            and child.parent_span_id = f.span_id
          order by child.ts asc, child.id asc
          limit 1
       ) b on true
       where f.session_id = $1 and f.tier = 'front'
     ) t
     order by ts asc, kind
     limit 500`,
    [id],
  );
}

export interface VisitStats {
  sessions: number; // sessions actives (≥ 1 page vue) sur la fenêtre
  visits: number; // visites après découpage sur inactivité 30 min
  returning_count: number; // sessions d'un visiteur identifié déjà vu sur cette app
  new_count: number; // sessions d'un visiteur identifié jamais vu avant
  /** Sessions SANS identifiant de visiteur, donc absentes du partage ci-dessus.
   *  Ni nouvelles ni revenantes : inconnues. Le compter est ce qui empêche le
   *  camembert de faire passer un échantillon partiel pour la population. */
  unidentified_count: number;
}

/**
 * Lot 4 : dérive les VISITES (découpage 30 min) et new/returning au requêtage —
 * corrige les métriques par session (une session peut s'étaler des heures). Le
 * découpage reflète lib/sessions.splitVisits.
 *
 * NEW/RETURNING S'APPUIE SUR `visitor_id`, PAS SUR `user_hash`. L'ancienne
 * empreinte était dérivée du terminal (userAgent+langue+résolution+fuseau) :
 * dans un parc géré par une DSI, tout le monde partageait la même valeur, donc
 * le deuxième visiteur d'un modèle de poste donné était déclaré « revenant »
 * sans jamais être revenu. Voir migration-v57.
 *
 * DEUX CONSÉQUENCES ASSUMÉES. (1) Les sessions sans identifiant — tout
 * l'historique antérieur au 09/09/2026 — sortent du partage et sont comptées
 * à part, plutôt que réparties au jugé. (2) La sous-requête est enfin bornée
 * par `app_id` : une session sur une autre application ne rend plus « revenant »
 * un visiteur qui arrive ici pour la première fois.
 */
export async function visitStats(f: Filters): Promise<VisitStats> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  const [row] = await q<VisitStats>(
    `with ev as (
       select p.session_id, p.started_at as ts
       from rum_pageview p
       left join rum_session s using (session_id)
       where p.started_at > now() - interval '${itv}'
         and ($1::text is null or p.app_id = $1)
         and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     ),
     flagged as (
       select session_id,
         case when lag(ts) over (partition by session_id order by ts) is null
                   or ts - lag(ts) over (partition by session_id order by ts) > interval '30 minutes'
              then 1 else 0 end as new_visit
       from ev
     ),
     vis as (
       select count(distinct session_id)::int as sessions,
              coalesce(sum(new_visit), 0)::int as visits
       from flagged
     ),
     nr as (
       select
         count(*) filter (where identifie and is_returning)::int as returning_count,
         count(*) filter (where identifie and not is_returning)::int as new_count,
         count(*) filter (where not identifie)::int as unidentified_count
       from (
         select s.visitor_id is not null as identifie,
                exists(
                  select 1 from rum_session s2
                  where s2.visitor_id = s.visitor_id
                    and s2.app_id = s.app_id
                    and s2.started_at < s.started_at
                ) as is_returning
         from rum_session s
         where s.last_seen_at > now() - interval '${itv}'
           and ($1::text is null or s.app_id = $1)
           and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
       ) t
     )
     select vis.sessions, vis.visits, nr.returning_count, nr.new_count, nr.unidentified_count
       from vis, nr`,
    [f.app, f.device, ...seg.params],
  );
  return row ?? { sessions: 0, visits: 0, returning_count: 0, new_count: 0, unidentified_count: 0 };
}
