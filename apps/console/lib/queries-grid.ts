// Vue « historique de santé » (heatmap jour × heure + courbes associées).
// Fenêtre FIXE de 14 jours (indépendante de la plage choisie, comme les anomalies
// 24 h) : on veut lire la tenue dans la durée, pas la fenêtre courante. Le reste
// du contrat commun s'applique (périmètre, appareil, dimensions, bots, apps
// internes). Chaque requête est fail-soft (section supplémentaire : elle dégrade
// en vide plutôt que de casser l'Overview).
import { q } from "./db";
import { queryOf, type Filters } from "./filters";
import { fuseauDe } from "./fuseau";
import { compileScope, sessionJoin, type Bind } from "./query-compiler";
import { conditionsOf, type AnalyticsQuery } from "./query-contract";
import { softFail, sqlContext } from "./query-sql";
import type { SeriesRow } from "./queries";
import { CORE_VITALS } from "./rating";

/** Profondeur de l'historique affiché par la heatmap et les courbes. */
export const GRID_DAYS = 14;

// Bascule lecture rollups (migration-v12 : pré-agrégat horaire mergeable). Activée
// par RUM_USE_ROLLUPS=1 une fois les rollups peuplés (pg_cron / Supabase). Défaut :
// lignes brutes (comportement inchangé). Équivalence rollup == brut prouvée Δ=0
// (scripts/verify-rollups.mjs). Ne concerne que les agrégats EXACTEMENT mergeables
// (comptages : heatmap good/total, trafic) ; les p75 restent sur les lignes brutes.
const useRollups = () => process.env.RUM_USE_ROLLUPS === "1";

/**
 * Le pré-agrégat ne connaît que l'app et l'appareil, et compte AUSSI les bots : il
 * ne répond que si la requête ne demande rien d'autre. Un rollup sans navigateur
 * ne répond jamais à navigateur=Firefox.
 */
export function rollupCompatible(query: AnalyticsQuery): boolean {
  return (
    query.filters.includeBots &&
    conditionsOf(query.filters).every((c) => c.dimension === "device" && c.operator === "eq")
  );
}

/** Prédicats du pré-agrégat : app et appareil seulement (voir `rollupCompatible`). */
function rollupWhere(query: AnalyticsQuery, bind: Bind): string {
  const device = query.filters.device ? ` and r.device_type = ${bind(query.filters.device)}` : "";
  return compileScope(query, "r.app_id", bind) + device;
}

/** Fuseau d'affichage : celui de l'app demandée, sinon le défaut. */
function fuseauRequete(f: Filters): Promise<string> {
  return fuseauDe(queryOf(f).scope.requestedApp);
}

export interface HealthGridCell {
  day: string; // début de journée (timestamptz)
  hour: number; // 0–23
  good_w: number; // somme pondérée des mesures « good » (LCP ×2)
  total_w: number; // somme pondérée totale
}

/**
 * Part de mesures « good » par créneau (jour, heure) sur 14 j — même pondération
 * que le health score (LCP ×2). Sert à colorer une case par heure de la journée.
 */
export async function healthGrid(f: Filters): Promise<HealthGridCell[]> {
  // LE FUSEAU DE L'APPLICATION, pas celui du serveur (finding 2.8). Le
  // pré-agrégat `rum_rollup_hourly` reste écrit en UTC — une heure dure une
  // heure partout — mais le REGROUPEMENT en jours et en heures affichées se
  // fait en local, sinon la colonne « 9 h » montre le trafic de 11 h.
  const tz = await fuseauRequete(f);
  try {
    const sql = await sqlContext(f);
    if (useRollups() && rollupCompatible(sql.query)) {
      const zone = sql.bind(tz);
      return await q<HealthGridCell>(
        `select date_trunc('day', hour at time zone ${zone}) as day,
                extract(hour from hour at time zone ${zone})::int as hour,
                sum(good_w)::float as good_w, sum(total_w)::float as total_w
         from rum_rollup_hourly r
         where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'${rollupWhere(sql.query, sql.bind)}
         group by 1, 2 having sum(total_w) > 0`,
        sql.params,
      );
    }
    const zone = sql.bind(tz);
    const vitaux = sql.bind(CORE_VITALS);
    const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: null });
    return await q<HealthGridCell>(
      `select date_trunc('day', m.ts at time zone ${zone}) as day,
              extract(hour from m.ts at time zone ${zone})::int as hour,
              sum(case when m.rating = 'good'
                       then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
              sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w
       from rum_metric m
       ${sessionJoin("m", "s")}
       where m.ts >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
         -- Même filtre que le score de santé, pour la même raison : les phases
         -- réseau ne sont pas notables et plafonneraient chaque créneau.
         and m.name = any(${vitaux}::text[])${where}
       group by 1, 2`,
      sql.params,
    );
  } catch (e) {
    return softFail(e, []);
  }
}

export interface DailyTraffic {
  day: string; // date (jour)
  pageviews: number;
  errors: number;
}

/** Volume quotidien (pages vues / erreurs JS) sur 14 j, jours vides à zéro. */
export async function dailyTraffic(f: Filters): Promise<DailyTraffic[]> {
  // Journées découpées dans le fuseau de l'application (finding 2.8) : sinon la
  // journée coupe à 2 h du matin heure locale en été, et le trafic de soirée
  // bascule sur le lendemain.
  const tz = await fuseauRequete(f);
  try {
    const sql = await sqlContext(f);
    const zone = sql.bind(tz);
    const jours = `generate_series(
              date_trunc('day', now() at time zone ${zone}) - interval '${GRID_DAYS - 1} days',
              date_trunc('day', now() at time zone ${zone}),
              interval '1 day') gs(day)`;
    if (useRollups() && rollupCompatible(sql.query)) {
      const pv = rollupWhere(sql.query, sql.bind);
      const er = rollupWhere(sql.query, sql.bind);
      return await q<DailyTraffic>(
        `select gs.day::date as day,
                coalesce(pv.n, 0)::int as pageviews,
                coalesce(er.n, 0)::int as errors
         from ${jours}
         left join (
           select date_trunc('day', hour at time zone ${zone}) d, sum(pageviews)::int n
           from rum_rollup_hourly r
           where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'${pv}
           group by 1
         ) pv on pv.d = gs.day
         left join (
           select date_trunc('day', hour at time zone ${zone}) d, sum(errors)::int n
           from rum_rollup_hourly r
           where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'${er}
           group by 1
         ) er on er.d = gs.day
         order by 1`,
        sql.params,
      );
    }
    const pageviews = sql.where({ dataset: "views", row: "p", session: "s", time: null });
    const errors = sql.where({ dataset: "errors", row: "e", session: "s", time: null });
    return await q<DailyTraffic>(
      `select gs.day::date as day,
              coalesce(pv.n, 0)::int as pageviews,
              coalesce(er.n, 0)::int as errors
       from ${jours}
       left join (
         select date_trunc('day', p.started_at at time zone ${zone}) d, count(*)::int n
         from rum_pageview p
         ${sessionJoin("p", "s")}
         where p.started_at >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'${pageviews}
         group by 1
       ) pv on pv.d = gs.day
       left join (
         select date_trunc('day', e.ts at time zone ${zone}) d, sum(e.occurrences)::int n
         from rum_error e
         ${sessionJoin("e", "s")}
         where e.ts >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'${errors}
         group by 1
       ) er on er.d = gs.day
       order by 1`,
      sql.params,
    );
  } catch (e) {
    return softFail(e, []);
  }
}

/** p75 LCP par jour sur 14 j (réutilise VitalsTimeseries, buckets journaliers). */
export async function dailyLcpSeries(f: Filters): Promise<SeriesRow[]> {
  const tz = await fuseauRequete(f);
  try {
    const sql = await sqlContext(f);
    const zone = sql.bind(tz);
    const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: null });
    return await q<SeriesRow>(
      `select date_trunc('day', m.ts at time zone ${zone}) as bucket,
              percentile_cont(0.75) within group (order by m.value) as p75
       from rum_metric m
       ${sessionJoin("m", "s")}
       where m.name = 'LCP' and m.ts > now() - interval '${GRID_DAYS} days'${where}
       group by 1 order by 1`,
      sql.params,
    );
  } catch (e) {
    return softFail(e, []);
  }
}
