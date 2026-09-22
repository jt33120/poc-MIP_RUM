// Vue « historique de santé » (heatmap jour × heure + courbes associées).
// Fenêtre FIXE de 14 jours (indépendante de la plage choisie, comme les anomalies
// 24 h) : on veut lire la tenue dans la durée, pas la fenêtre courante. Le reste
// du contrat commun s'applique (périmètre, appareil, dimensions, bots, apps
// internes).
//
// Une lecture en échec LÈVE (F02). Elle rendait autrefois `[]` — « Pas assez de
// données sur 14 jours » pendant une panne, indiscernable d'une application sans
// trafic. L'écran l'enveloppe dans `lire()` (lib/lecture.ts) : la section dit
// « Lecture en échec », les autres sections de l'écran restent affichées.
import { q } from "./db";
import { queryOf, type Filters } from "./filters";
import { fuseauDe } from "./fuseau";
import { compileScope, sessionJoin, type Bind } from "./query-compiler";
import { conditionsOf, type AnalyticsQuery } from "./query-contract";
import { sqlContext } from "./query-sql";
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
}

export interface DailyTraffic {
  day: string; // date (jour)
  pageviews: number;
  errors: number;
}

/** Quels 14 jours lire (§ 5.20.2, F65). */
export interface OptionsJours {
  /**
   * `true` : les 14 jours COMPLETS qui précèdent aujourd'hui dans le fuseau de
   * l'app, `[début du jour J−14, début du jour J)` — la fenêtre des Tendances.
   * Défaut `false` : les 14 derniers jours, aujourd'hui (entamé) compris — ce que
   * lisent la Vue d'ensemble et la carte « Trafic » d'un tableau de bord (W-B7),
   * inchangé pour eux.
   */
  exclureAujourdhui?: boolean;
}

/**
 * Les jours d'une lecture quotidienne, et le prédicat de temps de ses lignes.
 *
 * AUJOURD'HUI EXCLU, LE PREMIER JOUR COMPLET. L'ancienne borne basse
 * (`now() − 14 jours`, à l'heure près) coupait le premier jour en son milieu :
 * une p75 et un compte calculés sur une demi-journée, lus comme une journée.
 * Exclu, aujourd'hui l'est par une borne haute au début du jour J local ; la
 * borne basse est le début du jour J−14 local, converti en instant (`at time zone`
 * sur une heure murale rend un instant). Sans exclusion, la fenêtre d'avant.
 */
function fenetreJours(zone: string, exclureAujourdhui: boolean): { jours: string; depuis: (colonne: string) => string } {
  const jourJ = `date_trunc('day', now() at time zone ${zone})`;
  if (!exclureAujourdhui) {
    return {
      jours: `generate_series(
            ${jourJ} - interval '${GRID_DAYS - 1} days',
            ${jourJ},
            interval '1 day') gs(day)`,
      depuis: (colonne) => `${colonne} >= date_trunc('hour', now()) - interval '${GRID_DAYS} days'`,
    };
  }
  return {
    jours: `generate_series(
            ${jourJ} - interval '${GRID_DAYS} days',
            ${jourJ} - interval '1 day',
            interval '1 day') gs(day)`,
    depuis: (colonne) =>
      `${colonne} >= (${jourJ} - interval '${GRID_DAYS} days') at time zone ${zone} and ${colonne} < ${jourJ} at time zone ${zone}`,
  };
}

/** Volume quotidien (pages vues / occurrences d'erreurs) sur 14 j, jours vides à zéro. */
export async function dailyTraffic(f: Filters, opts: OptionsJours = {}): Promise<DailyTraffic[]> {
  // Journées découpées dans le fuseau de l'application (finding 2.8) : sinon la
  // journée coupe à 2 h du matin heure locale en été, et le trafic de soirée
  // bascule sur le lendemain.
  const tz = await fuseauRequete(f);
  const sql = await sqlContext(f);
  const zone = sql.bind(tz);
  const { jours, depuis } = fenetreJours(zone, opts.exclureAujourdhui === true);
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
         where ${depuis("hour")}${pv}
         group by 1
       ) pv on pv.d = gs.day
       left join (
         select date_trunc('day', hour at time zone ${zone}) d, sum(errors)::int n
         from rum_rollup_hourly r
         where ${depuis("hour")}${er}
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
       where ${depuis("p.started_at")}${pageviews}
       group by 1
     ) pv on pv.d = gs.day
     left join (
       select date_trunc('day', e.ts at time zone ${zone}) d, sum(e.occurrences)::int n
       from rum_error e
       ${sessionJoin("e", "s")}
       where ${depuis("e.ts")}${errors}
       group by 1
     ) er on er.d = gs.day
     order by 1`,
    sql.params,
  );
}

/** Un jour de LCP : la p75 du jour et son effectif ; un jour sans mesure vaut `p75: null`, `n: 0`. */
export interface DailyLcp {
  /** Jour LOCAL (fuseau de l'app), « AAAA-MM-JJ » — du texte, jamais un `Date` à minuit local du serveur. */
  jour: string;
  p75: number | null;
  /** Mesures LCP du jour : un point sous 30 mesures est creux et n'entre pas dans l'ajustement. */
  n: number;
}

/**
 * p75 LCP par jour LOCAL sur 14 jours, jours sans mesure compris (§ 5.20.2).
 *
 * LES JOURS VIDES SONT RENDUS. La lecture ne rendait que les jours mesurés : un
 * graphe relie alors deux jours séparés par un trou, et une droite ajustée sur des
 * indices qui ne sont plus des jours. Chaque jour de la fenêtre a sa ligne
 * (`generate_series`), `p75: null` et `n: 0` s'il est vide.
 *
 * `exclureAujourdhui` : la fenêtre des Tendances (14 jours complets, aujourd'hui
 * exclu). Défaut : les 14 derniers jours, aujourd'hui compris — celle de la Vue
 * d'ensemble, dont l'axe est celui de `dailyTraffic(f)`.
 */
export async function dailyLcpSeries(f: Filters, opts: OptionsJours = {}): Promise<DailyLcp[]> {
  const tz = await fuseauRequete(f);
  const sql = await sqlContext(f);
  const zone = sql.bind(tz);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: null });
  const { jours, depuis } = fenetreJours(zone, opts.exclureAujourdhui === true);
  const lignes = await q<{ jour: string; p75: number | null; n: number }>(
    `select to_char(gs.day, 'YYYY-MM-DD') as jour, l.p75, coalesce(l.n, 0)::int as n
     from ${jours}
     left join (
       select date_trunc('day', m.ts at time zone ${zone}) as d,
              percentile_cont(0.75) within group (order by m.value) as p75,
              count(*)::int as n
       from rum_metric m
       ${sessionJoin("m", "s")}
       where m.name = 'LCP' and ${depuis("m.ts")}${where}
       group by 1
     ) l on l.d = gs.day
     order by gs.day`,
    sql.params,
  );
  return lignes.map((l) => ({ jour: l.jour, p75: l.p75 == null ? null : Number(l.p75), n: Number(l.n) }));
}
