// Vue « historique de santé » (heatmap jour × heure + courbes associées).
// Fenêtre FIXE de 14 jours (indépendante du filtre période, comme les anomalies
// 24 h) : on veut lire la tenue dans la durée, pas la fenêtre courante.
// Mêmes conventions de filtres que queries.ts : $1 = app (null = toutes),
// $2 = device (null = tous) ; l'intervalle vient d'une constante, jamais d'une
// entrée utilisateur. Chaque requête est fail-soft (section supplémentaire :
// elle dégrade en vide plutôt que de casser l'Overview).
import { q } from "./db";
import type { Filters } from "./filters";
import { internalClause, type SeriesRow } from "./queries";
import { CORE_VITALS } from "./rating";

/** Profondeur de l'historique affiché par la heatmap et les courbes. */
export const GRID_DAYS = 14;

// Bascule lecture rollups (migration-v12 : pré-agrégat horaire mergeable). Activée
// par RUM_USE_ROLLUPS=1 une fois les rollups peuplés (pg_cron / Supabase). Défaut :
// lignes brutes (comportement inchangé). Équivalence rollup == brut prouvée Δ=0
// (scripts/verify-rollups.mjs). Ne concerne que les agrégats EXACTEMENT mergeables
// (comptages : heatmap good/total, trafic) ; les p75 restent sur les lignes brutes.
const useRollups = () => process.env.RUM_USE_ROLLUPS === "1";

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
  try {
    if (useRollups())
      return await q<HealthGridCell>(
        `select date_trunc('day', hour) as day, extract(hour from hour)::int as hour,
                sum(good_w)::float as good_w, sum(total_w)::float as total_w
         from rum_rollup_hourly
         where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
           and ($1::text is null or app_id = $1)
           and ($2::text is null or device_type = $2)${internalClause(f, "app_id")}
         group by 1, 2 having sum(total_w) > 0`,
        [f.app, f.device],
      );
    return await q<HealthGridCell>(
      `select date_trunc('day', m.ts) as day,
              extract(hour from m.ts)::int as hour,
              sum(case when m.rating = 'good'
                       then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
              sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w
       from rum_metric m
       left join rum_session s using (session_id)
       where m.ts >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
         -- Même filtre que le score de santé, pour la même raison : les phases
         -- réseau ne sont pas notables et plafonneraient chaque créneau.
         and m.name = any($3::text[])
         and ($1::text is null or m.app_id = $1)
         and ($2::text is null or s.device_type = $2)${internalClause(f, "m.app_id")}
       group by 1, 2`,
      [f.app, f.device, CORE_VITALS],
    );
  } catch {
    return [];
  }
}

export interface DailyTraffic {
  day: string; // date (jour)
  pageviews: number;
  errors: number;
}

/** Volume quotidien (pages vues / erreurs JS) sur 14 j, jours vides à zéro. */
export async function dailyTraffic(f: Filters): Promise<DailyTraffic[]> {
  try {
    if (useRollups())
      return await q<DailyTraffic>(
        `select gs.day::date as day,
                coalesce(pv.n, 0)::int as pageviews,
                coalesce(er.n, 0)::int as errors
         from generate_series(
                date_trunc('day', now()) - interval '${GRID_DAYS - 1} days',
                date_trunc('day', now()),
                interval '1 day') gs(day)
         left join (
           select date_trunc('day', hour) d, sum(pageviews)::int n
           from rum_rollup_hourly
           where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
             and ($1::text is null or app_id = $1) and ($2::text is null or device_type = $2)${internalClause(f, "app_id")}
           group by 1
         ) pv on pv.d = gs.day
         left join (
           select date_trunc('day', hour) d, sum(errors)::int n
           from rum_rollup_hourly
           where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
             and ($1::text is null or app_id = $1) and ($2::text is null or device_type = $2)${internalClause(f, "app_id")}
           group by 1
         ) er on er.d = gs.day
         order by 1`,
        [f.app, f.device],
      );
    return await q<DailyTraffic>(
      `select gs.day::date as day,
              coalesce(pv.n, 0)::int as pageviews,
              coalesce(er.n, 0)::int as errors
       from generate_series(
              date_trunc('day', now()) - interval '${GRID_DAYS - 1} days',
              date_trunc('day', now()),
              interval '1 day') gs(day)
       left join (
         select date_trunc('day', p.started_at) d, count(*)::int n
         from rum_pageview p
         left join rum_session s using (session_id)
         where p.started_at >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
           and ($1::text is null or p.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "p.app_id")}
         group by 1
       ) pv on pv.d = gs.day
       left join (
         select date_trunc('day', e.ts) d, count(*)::int n
         from rum_error e
         left join rum_session s using (session_id)
         where e.ts >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
           and ($1::text is null or e.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "e.app_id")}
         group by 1
       ) er on er.d = gs.day
       order by 1`,
      [f.app, f.device],
    );
  } catch {
    return [];
  }
}

/** p75 LCP par jour sur 14 j (réutilise VitalsTimeseries, buckets journaliers). */
export async function dailyLcpSeries(f: Filters): Promise<SeriesRow[]> {
  try {
    return await q<SeriesRow>(
      `select date_trunc('day', m.ts) as bucket,
              percentile_cont(0.75) within group (order by m.value) as p75
       from rum_metric m
       left join rum_session s using (session_id)
       where m.name = 'LCP' and m.ts > now() - interval '${GRID_DAYS} days'
         and ($1::text is null or m.app_id = $1)
         and ($2::text is null or s.device_type = $2)${internalClause(f, "m.app_id")}
       group by 1 order by 1`,
      [f.app, f.device],
    );
  } catch {
    return [];
  }
}
