// Vue « historique de santé » (heatmap jour × heure + courbes associées).
// Fenêtre FIXE de 14 jours (indépendante du filtre période, comme les anomalies
// 24 h) : on veut lire la tenue dans la durée, pas la fenêtre courante.
// Mêmes conventions de filtres que queries.ts : $1 = app (null = toutes),
// $2 = device (null = tous) ; l'intervalle vient d'une constante, jamais d'une
// entrée utilisateur. Chaque requête est fail-soft (section supplémentaire :
// elle dégrade en vide plutôt que de casser l'Overview).
import { q } from "./db";
import { fuseauDe } from "./fuseau";
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
  // LE FUSEAU DE L'APPLICATION, pas celui du serveur (finding 2.8). Le
  // pré-agrégat `rum_rollup_hourly` reste écrit en UTC — une heure dure une
  // heure partout — mais le REGROUPEMENT en jours et en heures affichées se
  // fait en local, sinon la colonne « 9 h » montre le trafic de 11 h.
  const tz = await fuseauDe(f.app);
  try {
    if (useRollups())
      return await q<HealthGridCell>(
        `select date_trunc('day', hour at time zone $3) as day,
                extract(hour from hour at time zone $3)::int as hour,
                sum(good_w)::float as good_w, sum(total_w)::float as total_w
         from rum_rollup_hourly
         where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
           and ($1::text is null or app_id = $1)
           and ($2::text is null or device_type = $2)${internalClause(f, "app_id")}
         group by 1, 2 having sum(total_w) > 0`,
        [f.app, f.device, tz],
      );
    return await q<HealthGridCell>(
      `select date_trunc('day', m.ts at time zone $4) as day,
              extract(hour from m.ts at time zone $4)::int as hour,
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
      [f.app, f.device, CORE_VITALS, tz],
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
  // Journées découpées dans le fuseau de l'application (finding 2.8) : sinon la
  // journée coupe à 2 h du matin heure locale en été, et le trafic de soirée
  // bascule sur le lendemain.
  const tz = await fuseauDe(f.app);
  try {
    if (useRollups())
      return await q<DailyTraffic>(
        `select gs.day::date as day,
                coalesce(pv.n, 0)::int as pageviews,
                coalesce(er.n, 0)::int as errors
         from generate_series(
                date_trunc('day', now() at time zone $3) - interval '${GRID_DAYS - 1} days',
                date_trunc('day', now() at time zone $3),
                interval '1 day') gs(day)
         left join (
           select date_trunc('day', hour at time zone $3) d, sum(pageviews)::int n
           from rum_rollup_hourly
           where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
             and ($1::text is null or app_id = $1) and ($2::text is null or device_type = $2)${internalClause(f, "app_id")}
           group by 1
         ) pv on pv.d = gs.day
         left join (
           select date_trunc('day', hour at time zone $3) d, sum(errors)::int n
           from rum_rollup_hourly
           where hour >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
             and ($1::text is null or app_id = $1) and ($2::text is null or device_type = $2)${internalClause(f, "app_id")}
           group by 1
         ) er on er.d = gs.day
         order by 1`,
        [f.app, f.device, tz],
      );
    return await q<DailyTraffic>(
      `select gs.day::date as day,
              coalesce(pv.n, 0)::int as pageviews,
              coalesce(er.n, 0)::int as errors
       from generate_series(
              date_trunc('day', now() at time zone $3) - interval '${GRID_DAYS - 1} days',
              date_trunc('day', now() at time zone $3),
              interval '1 day') gs(day)
       left join (
         select date_trunc('day', p.started_at at time zone $3) d, count(*)::int n
         from rum_pageview p
         left join rum_session s using (session_id)
         where p.started_at >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
           and ($1::text is null or p.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "p.app_id")}
         group by 1
       ) pv on pv.d = gs.day
       left join (
         select date_trunc('day', e.ts at time zone $3) d, sum(e.occurrences)::int n
         from rum_error e
         left join rum_session s using (session_id)
         where e.ts >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'
           and ($1::text is null or e.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "e.app_id")}
         group by 1
       ) er on er.d = gs.day
       order by 1`,
      [f.app, f.device, tz],
    );
  } catch {
    return [];
  }
}

/** p75 LCP par jour sur 14 j (réutilise VitalsTimeseries, buckets journaliers). */
export async function dailyLcpSeries(f: Filters): Promise<SeriesRow[]> {
  const tz = await fuseauDe(f.app);
  try {
    return await q<SeriesRow>(
      `select date_trunc('day', m.ts at time zone $3) as bucket,
              percentile_cont(0.75) within group (order by m.value) as p75
       from rum_metric m
       left join rum_session s using (session_id)
       where m.name = 'LCP' and m.ts > now() - interval '${GRID_DAYS} days'
         and ($1::text is null or m.app_id = $1)
         and ($2::text is null or s.device_type = $2)${internalClause(f, "m.app_id")}
       group by 1 order by 1`,
      [f.app, f.device, tz],
    );
  } catch {
    return [];
  }
}
