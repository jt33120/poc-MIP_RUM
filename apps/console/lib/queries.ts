// Requêtes des pages cœur (Overview / Pages lentes / Sessions).
// Contrat commun P6.2 : périmètre d'apps, plage [from,to), appareil, dimensions,
// segment, bots et apps internes sont compilés par lib/query-compiler.ts en
// paramètres liés ; la jointure de session est toujours scopée par app.
import { q } from "./db";
import { DEBUT_SAMPLE_RATE, type EchantillonnageSessions } from "./echantillonnage";
import { type Filters, type FiltersLike } from "./filters";
import type { VitalName } from "./fmt-ids";
import { agregatEchantillonnage, echantillonnageDe, type LigneEchantillonnage } from "./queries-sessions";
import { bucketExpr, sessionJoin } from "./query-compiler";
import { bucketStarts, previousRange, type ResolvedRange } from "./query-contract";
import { alignerSeaux, isoSansMs } from "./series";
import { dimensionSchema } from "./query-schema";
import { sqlContext, type SqlContext } from "./query-sql";
import type { SessionCursor, SessionSearch } from "./sessions-search";
import {
  SEUIL_RANGS_NORMAUX,
  Z95,
  intervalleP75Lu,
  rangsQuantileNormalSql,
  type IntervalleP75,
} from "./stats/incertitude";

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
  /**
   * Intervalle à 95 % de la p75 (P*.1), calculé sur les mesures BRUTES de la
   * fenêtre — jamais sur des p75 horaires —, ou la raison de son absence
   * (« 7 mesures, 13 requises »).
   */
  intervalle: IntervalleP75;
}

/**
 * Agrégats par vital ET intervalle à 95 % de leur p75 (P*.1), dans UN balayage.
 *
 * L'intervalle se lit avec la p75 : les mesures triées sous 30 (rangs exacts,
 * calculés en JS), les deux statistiques d'ordre aux rangs normaux au-delà. Les
 * rangs SQL suivent la formule de `rangsQuantileNormal` opération par opération,
 * en float8, pour tomber sur les mêmes entiers (tests/integration/
 * vitals-intervalle-sql.test.ts). Partagé par `vitalsP75` et `vitalPercentiles` :
 * la tuile et la table des percentiles disent le MÊME intervalle.
 *
 * @param agregats colonnes calculées sur `value` (« percentile_cont(…) … as p75 »)
 * @param colonnes les mêmes, relues dans l'agrégat (« a.p75 »)
 */
async function agregatsAvecIntervalle<T extends { n: number }>(
  sql: SqlContext,
  where: string,
  agregats: string,
  colonnes: string,
): Promise<(T & { intervalle: IntervalleP75 })[]> {
  const seuil = sql.bind(SEUIL_RANGS_NORMAUX);
  const rangs = rangsQuantileNormalSql("count(*)", sql.bind(Z95));
  const rows = await q<T & { valeurs: number[] | null; bas: number | null; haut: number | null }>(
    `with m as (
       select m.name, m.value
       from rum_metric m
       ${sessionJoin("m", "s")}
       where true${where}
     ), agg as (
       select name,
              ${agregats},
              count(*)::int as n,
              case when count(*) < ${seuil}::int then array_agg(value order by value) end as valeurs,
              ${rangs.r} as r,
              ${rangs.s} as s
       from m
       group by name
     ), rangs as (
       select name, value, row_number() over (partition by name order by value) as rang
       from m
     )
     select a.name, ${colonnes}, a.n, a.valeurs,
            max(x.value) filter (where x.rang = a.r) as bas,
            max(x.value) filter (where x.rang = a.s) as haut
     from agg a
     left join rangs x on x.name = a.name and a.n >= ${seuil}::int and x.rang in (a.r, a.s)
     group by a.name, ${colonnes}, a.n, a.valeurs`,
    sql.params,
  );
  return rows.map(({ valeurs, bas, haut, ...v }) => ({
    ...(v as unknown as T),
    intervalle: intervalleP75Lu(v.n, valeurs, bas, haut),
  }));
}

/** p75 par vital sur la plage courante, ou la période précédente contiguë (shift=true). */
export async function vitalsP75(f: Filters, shift = false): Promise<VitalAgg[]> {
  const sql = await sqlContext(f);
  const where = sql.where({
    dataset: "vitals",
    row: "m",
    session: "s",
    time: "m.ts",
    ...(shift ? { range: previousRange(sql.query.range) } : {}),
  });
  return agregatsAvecIntervalle<Omit<VitalAgg, "intervalle">>(
    sql,
    where,
    `percentile_cont(0.75) within group (order by value) as p75,
              percentile_cont(0.5) within group (order by value) as p50`,
    "a.p75, a.p50",
  );
}

export interface VitalPercentiles {
  name: string;
  pcts: number[]; // [p50, p75, p90, p95, p99] (percentile_cont array, ordre PCTS)
  n: number;
  /** Intervalle à 95 % du p75 (P*.1), le même que celui de la tuile de `/`. */
  intervalle: IntervalleP75;
}

/** p50/p75/p90/p95/p99 par vital — la distribution que le seul p75 masque. */
export async function vitalPercentiles(f: Filters): Promise<VitalPercentiles[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  return agregatsAvecIntervalle<Omit<VitalPercentiles, "intervalle">>(
    sql,
    where,
    "percentile_cont(array[0.5,0.75,0.9,0.95,0.99]) within group (order by value) as pcts",
    "a.pcts",
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
  const sql = await sqlContext(f);
  const nom = sql.bind(name);
  const plafond = sql.bind(cap);
  const tranches = sql.bind(nbuckets);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  return q<HistoRow>(
    `select width_bucket(m.value, 0, ${plafond}::float, ${tranches}::int) as bucket, count(*)::int as count
     from rum_metric m
     ${sessionJoin("m", "s")}
     where m.name = ${nom}${where}
     group by 1 order by 1`,
    sql.params,
  );
}

export interface OverviewStats {
  sessions: number;
  errors: number;
  pageviews: number;
}

/** Sessions vues, erreurs (occurrences) et pages vues sur la plage, ou la précédente (shift). */
export async function overviewStats(f: Filters, shift = false): Promise<OverviewStats> {
  const sql = await sqlContext(f);
  const range = shift ? previousRange(sql.query.range) : undefined;
  const sessions = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.last_seen_at", range });
  const errors = sql.where({ dataset: "errors", row: "e", session: "s", time: "e.ts", range });
  const pageviews = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at", range });
  const [row] = await q<OverviewStats>(
    `select
       (select count(*)::int from rum_session s where true${sessions}) as sessions,
       (select coalesce(sum(e.occurrences), 0)::int from rum_error e
         ${sessionJoin("e", "s")}
         where true${errors}) as errors,
       (select count(*)::int from rum_pageview p
         ${sessionJoin("p", "s")}
         where true${pageviews}) as pageviews`,
    sql.params,
  );
  return row;
}

export interface SeriesRow {
  bucket: string;
  p75: number;
}

/** Série temporelle p75 d'un vital, seaux alignés UTC de la largeur de la plage. */
export async function vitalSeries(f: Filters, name: string): Promise<SeriesRow[]> {
  const sql = await sqlContext(f);
  const nom = sql.bind(name);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  return q<SeriesRow>(
    `select ${bucketExpr("m.ts", sql.query.range)} as bucket,
            percentile_cont(0.75) within group (order by m.value) as p75
     from rum_metric m
     ${sessionJoin("m", "s")}
     where m.name = ${nom}${where}
     group by 1 order by 1`,
    sql.params,
  );
}

// ═══════════════════ Lectures partagées du domaine performance (F10) ═══════════════════
//
// Registre : plan § 4.5. Toutes passent par `sqlContext(f)` (périmètre d'apps LIÉ,
// `apps = []` = zéro ligne, R-A) et acceptent `shift` (`cmp=prev`) : la même mesure
// sur `previousRange`, même largeur de seau, alignée PAR RANG de seau (§ 3.2).
//
// LA GRILLE EST POSÉE ICI, PAS PAR L'APPELANT. Une série rend UN point par début de
// seau attendu (`bucketStarts(range)`), rapproché par `alignerSeaux` (F04, § 3.10) :
// un seau sans mesure garde `p75: null` (un trou, jamais « 0 ms » noté « Bon ») ;
// seuls les COMPTES additifs y valent 0 (aucune vue dans le seau, c'est 0 vue).
// `alignerSeaux(…, additif = true)` ne sait pas zéro-remplir une série SANS aucune
// ligne (il ne connaît alors aucun champ) : les séries de comptes remplissent donc
// elles-mêmes les seaux vides, champ par champ.

/** Plage lue : la fenêtre du contrat, ou la période précédente contiguë. */
export function plageLue(range: ResolvedRange, shift: boolean): ResolvedRange {
  return shift ? previousRange(range) : range;
}

/**
 * Pose des lignes de seaux (bucket rendu par node-postgres en `Date`) sur la grille
 * du contrat ; `vide(t)` fabrique le point d'un seau sans ligne. Rend les instants
 * en ISO UTC sans millisecondes (`isoSansMs`), la clé que prennent les figures.
 */
export function surGrille<R extends { bucket: string | Date }, P>(
  rows: R[],
  range: ResolvedRange,
  plein: (row: R, t: string) => P,
  vide: (t: string) => P,
): P[] {
  const starts = bucketStarts(range);
  return alignerSeaux(rows, starts, false).map((row, i) => {
    const t = isoSansMs(starts[i]);
    return row === null ? vide(t) : plein(row, t);
  });
}

export interface VitalSeriesPoint {
  /** Début du seau, ISO UTC. */
  bucket: string;
  /** p75 des mesures BRUTES du seau ; `null` : aucune mesure (un trou, pas un zéro). */
  p75: number | null;
  /** Mesures du seau (point creux sous `faibleSous`, § 3.10). */
  n: number;
}

/**
 * p75 d'un vital par seau du contrat, AVEC l'effectif du seau (CP4) : `vitalSeries`
 * ne rend que les seaux non vides et sans `n`. Chaque p75 est calculé sur les
 * mesures brutes de son seau ; aucun p75 n'est jamais agrégé d'un autre (V5).
 */
export async function vitalSeriesN(f: FiltersLike, name: VitalName, shift = false): Promise<VitalSeriesPoint[]> {
  const sql = await sqlContext(f);
  const range = plageLue(sql.query.range, shift);
  const nom = sql.bind(name);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts", range });
  const rows = await q<{ bucket: Date; p75: number; n: number }>(
    `select ${bucketExpr("m.ts", range)} as bucket,
            percentile_cont(0.75) within group (order by m.value) as p75,
            count(*)::int as n
     from rum_metric m
     ${sessionJoin("m", "s")}
     where m.name = ${nom}${where}
     group by 1 order by 1`,
    sql.params,
  );
  return surGrille<(typeof rows)[number], VitalSeriesPoint>(
    rows,
    range,
    (r, t) => ({ bucket: t, p75: r.p75, n: r.n }),
    (t) => ({ bucket: t, p75: null, n: 0 }),
  );
}

/**
 * Sessions distinctes ayant AU MOINS UNE page vue dont `started_at ∈ [from, to)` —
 * SEULE définition du dénominateur « sessions avec vue » (R-P, CP7). Une vue sans
 * session n'en est pas une ; la session est comptée par `(app_id, session_id)`,
 * jamais par son seul identifiant (émis par le client).
 */
export async function sessionsAvecVue(f: FiltersLike, shift = false): Promise<number> {
  const sql = await sqlContext(f);
  const range = plageLue(sql.query.range, shift);
  const where = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at", range });
  const [row] = await q<{ n: number }>(
    `select count(*)::int as n
       from (select distinct p.app_id, p.session_id
               from rum_pageview p
               ${sessionJoin("p", "s")}
              where p.session_id is not null${where}) v`,
    sql.params,
  );
  return row?.n ?? 0;
}

export interface PageviewSeriesPoint {
  bucket: string;
  /** Vues de chargement (`nav_type` navigate / reload / back_forward) : seules à porter un LCP (CP17). */
  chargements: number;
  /** Changements de route SPA (`nav_type = 'spa'`). */
  spa: number;
  /**
   * Vues sans `nav_type` (émetteur qui ne le déclare pas) : ni rangées d'office
   * parmi les chargements, ni perdues — Σ des trois = pages vues du seau.
   */
  inconnu: number;
}

/**
 * Pages vues par seau du contrat, chargements et changements de route SPA séparés
 * (CP17). Série ADDITIVE : un seau sans vue vaut 0, et la somme des seaux égale
 * `overviewStats(f).pageviews` pour la même plage.
 */
export async function pageviewSeries(f: FiltersLike, shift = false): Promise<PageviewSeriesPoint[]> {
  const sql = await sqlContext(f);
  const range = plageLue(sql.query.range, shift);
  const where = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at", range });
  const rows = await q<{ bucket: Date; chargements: number; spa: number; inconnu: number }>(
    `select ${bucketExpr("p.started_at", range)} as bucket,
            count(*) filter (where p.nav_type is not null and p.nav_type <> 'spa')::int as chargements,
            count(*) filter (where p.nav_type = 'spa')::int as spa,
            count(*) filter (where p.nav_type is null)::int as inconnu
     from rum_pageview p
     ${sessionJoin("p", "s")}
     where true${where}
     group by 1 order by 1`,
    sql.params,
  );
  return surGrille(
    rows,
    range,
    (r, t) => ({ bucket: t, chargements: r.chargements, spa: r.spa, inconnu: r.inconnu }),
    (t) => ({ bucket: t, chargements: 0, spa: 0, inconnu: 0 }),
  );
}

/**
 * Échantillonnage de la population des Web Vitals (R-E) : sessions portant au moins
 * une mesure dans la fenêtre, sous les filtres de l'écran. Même formule
 * biaisée-erreurs que `samplingSessions` (B38) : `agregatEchantillonnage`.
 *
 * `probaMin` vaut `null` quand une session de la population a commencé avant le
 * 09/09/2026 (v58 : `sample_rate = 1` PAR DÉFAUT, pas par mesure — un minimum qui
 * la compterait à 100 % serait inventé) ou quand aucune session n'est lue. Les
 * autres champs (`sessions`, `sansTaux`, `biaiseErreurs`) distinguent ces deux
 * cas et servent `etatEchantillonnage` tels quels.
 */
export async function samplingVitals(f: FiltersLike): Promise<EchantillonnageSessions> {
  const sql = await sqlContext(f);
  const debut = sql.bind(DEBUT_SAMPLE_RATE);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const [row] = await q<LigneEchantillonnage>(
    `with population as (
       select distinct m.app_id, m.session_id
         from rum_metric m
         ${sessionJoin("m", "s")}
        where m.session_id is not null${where}
     )
     select ${agregatEchantillonnage(debut)}
       from population p
       join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id`,
    sql.params,
  );
  const e = echantillonnageDe(row);
  return e.sansTaux > 0 ? { ...e, probaMin: null } : e;
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
  const sql = await sqlContext(f);
  const vues = sql.where({ dataset: "views", row: "p", session: "ps", time: "p.started_at" });
  const taches = sql.where({ dataset: "longtasks", row: "l", session: "ls", time: "l.ts" });
  const vitals = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  return q<RouteRow>(
    `with vues as (
       select p.route, count(*)::int as views
         from rum_pageview p
         ${sessionJoin("p", "ps")}
        where p.route is not null${vues}
        group by p.route
     ),
     taches as (
       select l.route, count(*)::int as longtasks
         from rum_longtask l
         ${sessionJoin("l", "ls")}
        where l.route is not null${taches}
        group by l.route
     ),
     vitals as (
       select m.route,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as lcp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as inp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'CLS') as cls_p75
         from rum_metric m
         ${sessionJoin("m", "s")}
        where m.route is not null${vitals}
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
    sql.params,
  );
}

/**
 * Routes DISTINCTES vues sur la fenêtre. Sert à dire si la liste ci-dessus est
 * tronquée, et à faire remonter une explosion de cardinalité avant qu'elle ne
 * rende l'écran inutile.
 */
export async function nombreDeRoutes(f: Filters): Promise<number> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const [r] = await q<{ n: number }>(
    `select count(distinct m.route)::int as n
       from rum_metric m
       ${sessionJoin("m", "s")}
      where m.route is not null${where}`,
    sql.params,
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
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "resources", row: "r", session: "s", time: "r.ts" });
  const rows = await q<SlowResource>(
    `select route, url, type, avg_ms, n, render_blocking from (
       select r.route, r.url, max(r.type) as type,
              avg(r.duration_ms) as avg_ms, count(*)::int as n,
              bool_or(r.render_blocking) as render_blocking,
              row_number() over (partition by r.route order by avg(r.duration_ms) desc) as rk
       from rum_resource r
       ${sessionJoin("r", "s")}
       where r.route is not null${where}
       group by r.route, r.url
     ) x where rk <= 3`,
    sql.params,
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
  /** P8.7 (v85) : d'où vient `geo_country`. NULL = provenance inconnue (historique). */
  geo_source?: string | null;
  geo_db_version?: string | null;
  user_agent: string | null;
  started_at: Date;
  last_seen_at: Date;
  page_count: number;
  routes: string[] | null;
  err_count: number;
  collection_source: string | null; // 'sdk' (défaut) | 'extension'
  /** Position de pagination stable, microsecondes conservées (P6.3). */
  cursor_ts: string;
}

export interface SessionListPage {
  limit?: number;
  /** Pagination historique de l'API v1 ; ignoré dès qu'un curseur est fourni. */
  offset?: number;
  /** Pagination stable de la console (P6.3) : reprend après cette clé. */
  cursor?: SessionCursor | null;
  /** Recherche bornée (identifiant exact, route normalisée, release). */
  search?: SessionSearch | null;
}

/**
 * Prédicat d'une recherche de session (P6.3). Route et release sont des
 * dimensions PAR OCCURRENCE : elles se lisent sur les pages vues de la session,
 * et non sur `rum_session.release`, qui ne retient que la première release vue et
 * décrirait donc le passé avec une valeur unique. Sans la colonne de v75, la
 * recherche par release retombe sur la session, et l'écran le dit.
 *
 * Valeur toujours LIÉE, comparaison toujours en égalité stricte.
 */
function rechercheSql(sql: SqlContext, search: SessionSearch): string {
  if (search.field === "session") return ` and s.session_id = ${sql.bind(search.value)}`;
  if (search.field === "route") {
    return ` and exists (select 1 from rum_pageview rp
              where rp.app_id = s.app_id and rp.session_id = s.session_id and rp.route = ${sql.bind(search.value)})`;
  }
  if (!sql.schema.has("rum_pageview.release")) return ` and s.release = ${sql.bind(search.value)}`;
  return ` and exists (select 1 from rum_pageview rp
            where rp.app_id = s.app_id and rp.session_id = s.session_id and rp.release = ${sql.bind(search.value)})`;
}

/** La recherche par release porte-t-elle sur l'occurrence, ou sur la session faute de colonne ? */
export async function releaseRechercheParOccurrence(): Promise<boolean> {
  return (await dimensionSchema()).has("rum_pageview.release");
}

/**
 * Sessions vues sur la plage, les plus récentes d'abord ; pages et erreurs de la
 * même app. La clé de tri `(last_seen_at, session_id)` est stricte et totale :
 * avec un curseur, deux pages successives ne peuvent ni répéter ni sauter une
 * ligne, même si des sessions sont vues entre les deux lectures.
 */
export async function listSessions(f: Filters, page?: SessionListPage): Promise<SessionRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.last_seen_at" });
  const recherche = page?.search ? rechercheSql(sql, page.search) : "";
  const curseur = page?.cursor
    ? ` and (s.last_seen_at, s.session_id) < (${sql.bind(page.cursor.ts)}::timestamptz, ${sql.bind(page.cursor.id)})`
    : "";
  const limit = sql.bind(page?.limit ?? 50);
  const offset = sql.bind(page?.cursor ? 0 : (page?.offset ?? 0));
  return q<SessionRow>(
    `select s.*, p.routes, coalesce(e.err_count, 0)::int as err_count,
            to_char(s.last_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
     from rum_session s
     left join lateral (
       select array_agg(route order by started_at) as routes
       from rum_pageview where app_id = s.app_id and session_id = s.session_id
     ) p on true
     left join lateral (
       select coalesce(sum(occurrences), 0)::int as err_count
       from rum_error where app_id = s.app_id and session_id = s.session_id
     ) e on true
     where true${where}${recherche}${curseur}
     order by s.last_seen_at desc, s.session_id desc
     limit ${limit} offset ${offset}`,
    sql.params,
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
  /** P8.7 (v85) : d'où vient `geo_country`, et avec quelle livraison DB-IP. */
  geo_source?: string | null;
  geo_db_version?: string | null;
  started_at: Date;
  last_seen_at: Date;
  page_count: number;
  collection_source: string | null; // 'sdk' (défaut) | 'extension'
  // F44 — colonnes déjà rendues par `select *`, typées pour l'en-tête du détail.
  // Optionnelles : absentes d'un schéma antérieur à leur migration.
  /** v75 : navigateur et système déduits à l'ingestion. */
  browser?: string | null;
  browser_version?: string | null;
  os?: string | null;
  os_version?: string | null;
  /** v53 : release à l'OUVERTURE de la session (mutable ; celle des occurrences fait foi). */
  release?: string | null;
  /** v82 : runtime de l'émetteur (`react_native` : pas de signaux de frustration). */
  runtime?: string | null;
  /** v58 : taux d'échantillonnage ; 1 PAR DÉFAUT sur les sessions d'avant le 09/09/2026. */
  sample_rate?: number | null;
  error_sample_rate?: number | null;
  has_error?: boolean | null;
  // `user_id_hash` et `account_id_hash` (v66) viennent aussi du `select *` et ne
  // sont volontairement PAS typés : aucun écran ne doit pouvoir les afficher (S5).
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
  value: number | null; // valeur vital | seq | duration_ms | occurrences (erreur, schéma ≥ v67)
  rating: string | null; // good|needs-improvement|poor (vitals)
  action_id: string | null;
  action_name: string | null;
}

/**
 * Timeline fusionnée chronologique d'une session (toutes tables v0.1 + v0.2).
 *
 * `appId` = `rum_session.app_id` de la session, lié dans CHAQUE branche : le
 * `session_id` est émis par le client, et une ligne d'une autre app qui citerait
 * le même identifiant entrerait sinon dans le détail, le récit (P*.9) et
 * `GET /api/v1/sessions/{id}` (V7).
 */
export async function sessionTimeline(id: string, appId: string): Promise<TimelineItem[]> {
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
           from rum_pageview where session_id = $1 and app_id = $2
           union all
           select 'vital', ts, name, route, value, rating, null, null, app_id
           from rum_metric where session_id = $1 and app_id = $2
           union all
           select 'action', ts, name, type || coalesce(' · ' || route, ''), null, null, action_id, name, app_id
           from rum_action where session_id = $1 and app_id = $2
           union all
           -- value = occurrences (B32, partie « occurrences ») : une ligne peut
           -- porter un lot SDK ; le récit P*.9 les SOMME (V1). Colonne v59, donc
           -- présente dans cette branche v67 ; la branche v66 garde null.
           select 'error', ts, coalesce(error_type, kind), message, occurrences::float, null, action_id, null, app_id
           from rum_error where session_id = $1 and app_id = $2
           union all
           select 'breadcrumb', ts, type, label, seq::float, null, action_id, null, app_id
           from rum_breadcrumb where session_id = $1 and app_id = $2
           union all
           select 'resource', ts, coalesce(type, 'resource'), url, duration_ms, null, action_id, null, app_id
           from rum_resource where session_id = $1 and app_id = $2 and action_id is not null
           union all
           select 'longtask', ts,
                  case when script_function is not null and script_function <> ''
                            then 'Blocage · ' || script_function
                       when invoker is not null and invoker <> ''
                            then 'Blocage · ' || invoker
                       else 'Long task' end,
                  coalesce(route, '') || coalesce(' · ' || regexp_replace(script_url, '^https?://', ''), ''),
                  coalesce(blocking_ms, duration_ms), null, null, null, app_id
           from rum_longtask where session_id = $1 and app_id = $2
           union all
           select 'event', ts, name, props::text, null, null, action_id, null, app_id
           from rum_event where session_id = $1 and app_id = $2 and event_type is distinct from 'action'
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
           where f.session_id = $1 and f.app_id = $2 and f.tier = 'front'
         ) t
         left join rum_action a
           on a.action_id = t.action_id and a.app_id = t.app_id and a.session_id = $1
        order by t.ts asc, case when t.kind = 'action' then 0 else 1 end, t.kind
        limit 500`,
      [id, appId],
    );
  }
  return q<TimelineItem>(
    `select kind, ts, title, detail, value, rating,
            null::text as action_id, null::text as action_name from (
       select 'pageview' as kind, started_at as ts, route as title, nav_type as detail,
              null::float as value, null::text as rating
       from rum_pageview where session_id = $1 and app_id = $2
       union all
       select 'vital', ts, name, route, value, rating
       from rum_metric where session_id = $1 and app_id = $2
       union all
       select 'error', ts, coalesce(error_type, kind), message, null, null
       from rum_error where session_id = $1 and app_id = $2
       union all
       select 'breadcrumb', ts, type, label, seq::float, null
       from rum_breadcrumb where session_id = $1 and app_id = $2
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
       from rum_longtask where session_id = $1 and app_id = $2
       union all
       select 'event', ts, name, props::text, null, null
       from rum_event where session_id = $1 and app_id = $2
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
       where f.session_id = $1 and f.app_id = $2 and f.tier = 'front'
     ) t
     order by ts asc, kind
     limit 500`,
    [id, appId],
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
  const sql = await sqlContext(f);
  const vues = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at" });
  const sessions = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.last_seen_at" });
  const [row] = await q<VisitStats>(
    `with ev as (
       select p.session_id, p.started_at as ts
       from rum_pageview p
       ${sessionJoin("p", "s")}
       where true${vues}
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
         where true${sessions}
       ) t
     )
     select vis.sessions, vis.visits, nr.returning_count, nr.new_count, nr.unidentified_count
       from vis, nr`,
    sql.params,
  );
  return row ?? { sessions: 0, visits: 0, returning_count: 0, new_count: 0, unidentified_count: 0 };
}
