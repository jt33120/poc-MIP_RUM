// Requêtes SQL v0.3 (chantier A4) : triage des erreurs, alerting, corrélation v2.
import { q } from "./db";
import { periodOf, queryOf, type FiltersLike } from "./filters";
import { isValidEventName } from "./queries-events";
import { binder, bucketExpr, compileScope, sessionJoin } from "./query-compiler";
import type { AnalyticsQuery } from "./query-contract";
import { sqlContext, type SqlContext } from "./query-sql";
import { THRESHOLDS } from "./rating";

// ---------------------------------------------------------------------------
// Filtres globaux — FAÇADE « v2 » du contrat commun (lib/query-contract.ts)
//
// Forme historique : app `string` ('all' = toutes), device `string` (+ 'tablet').
// Elle ne sert plus qu'aux lectures pas encore migrées vers le contrat (logs, SVI,
// assistant IA) : ces écrans n'acceptent que les presets et leur page valide l'URL
// par `pageFilters` avant de dériver cette façade avec `v2FiltersOf`. Les
// lectures migrées (corrélation, alertes) prennent la requête résolue.
// ---------------------------------------------------------------------------

const PERIODS = {
  "1h": { interval: "1 hour", label: "1 h" },
  "24h": { interval: "24 hours", label: "24 h" },
  "7d": { interval: "7 days", label: "7 j" },
} as const;
export type PeriodKey = keyof typeof PERIODS;

export interface Filters {
  app: string; // 'all' = toutes les apps
  period: PeriodKey;
  device: string; // 'all' = tous les devices
}

/** Façade v2 d'une requête résolue par le contrat (écrans à presets). */
export function v2FiltersOf(query: AnalyticsQuery): Filters {
  return {
    app: query.scope.requestedApp ?? "all",
    period: periodOf(query),
    device: query.filters.device ?? "all",
  };
}

export function periodInterval(f: Filters): string {
  return PERIODS[f.period].interval;
}

export function periodLabel(f: Filters): string {
  return PERIODS[f.period].label;
}


// ---------------------------------------------------------------------------
// Triage des groupes d'erreurs (error_status). Les LECTURES de groupes —
// compteurs, tendance, détail, occurrences — vivent dans ./queries-errors.ts
// (P5.1), sur le modèle de filtres de ./filters.ts.
// ---------------------------------------------------------------------------

/** Statuts de triage d'un groupe d'erreurs — allow-list TS (pas de CHECK en base). */
export const ERROR_STATUSES = ["open", "resolved", "ignored"] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

/** Écrit le statut de triage d'un groupe (upsert). status='resolved' → tamponne
 *  resolved_at (référence de régression) ; toute autre valeur l'efface. */
export async function setErrorStatus(
  appId: string,
  fingerprint: string,
  status: ErrorStatus,
  operator: string,
): Promise<void> {
  await q(
    `insert into error_status (app_id, fingerprint, status, resolved_at, resolved_by, updated_at)
     values ($1, $2, $3, case when $3 = 'resolved' then now() else null end, $4, now())
     on conflict (app_id, fingerprint) do update
       set status = excluded.status,
           resolved_at = case when excluded.status = 'resolved' then now() else null end,
           resolved_by = excluded.resolved_by,
           updated_at = now()`,
    [appId, fingerprint, status, operator],
  );
}

// ---------------------------------------------------------------------------
// Alerting (alert_rule / alert_event / check_alerts)
// ---------------------------------------------------------------------------

// Métriques éligibles comme CIBLE DE SLO : uniquement celles qui ont un sens
// « % de mesures conformes » (vitals + taux d'erreur). Un coût/compte absolu
// n'entre pas dans ce modèle -> exclu des SLO.
export const SLO_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB", "error_rate"] as const;

// Métriques éligibles comme RÈGLE D'ALERTE : les métriques SLO + deux métriques
// opérationnelles absolues (budget IA, pics d'erreurs applicatives) évaluées par
// check_alerts (migration-v38), puis les familles paramétrées `event:<nom>` (P4)
// et `issue:<uuid>` (P5.6, occurrences d'une issue d'erreurs).
export const ALERT_METRICS = [...SLO_METRICS, "log_errors", "event", "issue"] as const;
export const ALERT_COMPARATORS = [">", "<"] as const;

const ISSUE_METRIC = /^issue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Dernière évaluation d'une règle par check_alerts (migration-v73). */
export const RULE_STATES = ["ok", "breached", "no_data"] as const;
export type RuleState = (typeof RULE_STATES)[number];

/** Libellé lisible + unité d'une métrique d'alerte/SLO (dropdowns, feed d'événements). */
export const METRIC_LABELS: Record<string, string> = {
  LCP: "LCP (ms)",
  INP: "INP (ms)",
  CLS: "CLS",
  FCP: "FCP (ms)",
  TTFB: "TTFB (ms)",
  error_rate: "Taux d'erreur JS",
  log_errors: "Logs ERROR (nombre)",
  event: "Événement custom (nombre)",
  issue: "Issue d'erreurs (occurrences)",
};

/** Libellé d'une métrique (repli : la clé brute si inconnue). */
export function metricLabel(metric: string): string {
  if (metric.startsWith("event:")) return `Événement « ${metric.slice(6)} » (nombre)`;
  if (ISSUE_METRIC.test(metric)) return `Issue ${metric.slice(6, 14)} (occurrences)`;
  return METRIC_LABELS[metric] ?? metric;
}

export function isAlertMetric(metric: string): boolean {
  if (metric !== "event" && metric !== "issue" && (ALERT_METRICS as readonly string[]).includes(metric)) return true;
  if (metric.startsWith("issue:")) return ISSUE_METRIC.test(metric);
  return metric.startsWith("event:") && isValidEventName(metric.slice(6));
}

export interface AlertRuleRow {
  id: number;
  app_id: string;
  metric: string;
  route: string | null;
  comparator: string;
  threshold: number;
  window_minutes: number;
  webhook_url: string | null;
  active: boolean;
  created_at: Date;
  mode: string;
  severity: string;
  sensitivity: number;
  baseline_weeks: number;
  unacked: number;
  /** Règle issue:<uuid> : env des occurrences comptées (null = tous). */
  env: string | null;
  /** null : jamais évaluée, ou base antérieure à migration-v73. */
  last_state: RuleState | null;
  last_value: number | null;
  last_reason: string | null;
  last_evaluated_at: Date | null;
}

/**
 * Règles d'alerte : une LISTE DE CONFIGURATION. Seul le périmètre d'apps la borne ;
 * la plage et les filtres de population ne décrivent pas l'évaluation d'une règle
 * (métrique, route, fenêtre et env qui lui sont propres) et l'écran ne les annonce
 * pas comme appliqués.
 */
export async function alertRules(f: FiltersLike): Promise<AlertRuleRow[]> {
  const { params, bind } = binder();
  // Colonnes de migration-v73 lues par `to_jsonb` : une clé absente vaut NULL, là
  // où citer la colonne ferait échouer la page si la console précède la migration.
  return q<AlertRuleRow>(
    `select r.id::int as id, r.app_id, r.metric, r.route, r.comparator, r.threshold,
            r.window_minutes, r.webhook_url, r.active, r.created_at,
            r.mode, r.severity, r.sensitivity, r.baseline_weeks,
            (select count(*)::int from alert_event ae
              where ae.rule_id = r.id and not ae.acknowledged) as unacked,
            to_jsonb(r)->>'env' as env,
            to_jsonb(r)->>'last_state' as last_state,
            (to_jsonb(r)->>'last_value')::float8 as last_value,
            to_jsonb(r)->>'last_reason' as last_reason,
            (to_jsonb(r)->>'last_evaluated_at')::timestamptz as last_evaluated_at
     from alert_rule r
     where true${compileScope(queryOf(f), "r.app_id", bind)}
     order by r.id desc`,
    params,
  );
}

export interface AlertEventRow {
  id: number;
  rule_id: number | null;
  fired_at: Date;
  value: number | null;
  message: string | null;
  acknowledged: boolean;
  severity: string;
  metric: string;
  app_id: string;
  route: string | null;
  /** Livraisons CONFIRMÉES (2xx observé). 0 = l'alerte s'est déclenchée sans que
   *  personne n'en soit averti. Ne compte pas 'sent' : depuis migration-v49, ce
   *  statut signifie seulement que pg_net a accepté la requête — le code HTTP
   *  n'est pas encore connu, et un 404 s'y cachait indistinctement. */
  delivered: number;
  /** Livraisons transmises dont le résultat n'est pas encore réconcilié. */
  pending: number;
}

/**
 * Sources d'un événement : sa règle, son SLO et, depuis migration-v73, la
 * notification d'issue qui l'a produit (nouvelle issue ou régression, sans règle).
 * Sans cette dernière, un événement d'issue n'aurait pas d'app et disparaîtrait
 * de la page dès qu'une app est choisie.
 */
async function sourcesEvenement(): Promise<{ jointures: string; app: string }> {
  const [schema] = await q<{ v73: boolean }>(
    "select to_regclass('public.error_issue_notification') is not null as v73",
  );
  return schema?.v73
    ? {
        jointures: `left join alert_rule r on r.id = ae.rule_id
     left join slo s on s.id = ae.slo_id
     left join error_issue_notification n on n.alert_event_id = ae.id`,
        app: "coalesce(r.app_id, s.app_id, n.app_id)",
      }
    : {
        jointures: `left join alert_rule r on r.id = ae.rule_id
     left join slo s on s.id = ae.slo_id`,
        app: "coalesce(r.app_id, s.app_id)",
      };
}

/** Un événement vient d'une règle, d'un SLO ou d'une issue : left joins + coalesce des champs.
 *  `delivered` compte les livraisons effectives — sans lui, l'interface affichait
 *  une alerte « déclenchée » sans dire qu'elle n'avait atteint personne. Les 100
 *  derniers déclenchements du périmètre : chacun a été évalué sur la fenêtre de sa
 *  règle, pas sur la plage de l'écran. */
export async function alertEvents(f: FiltersLike): Promise<AlertEventRow[]> {
  const sources = await sourcesEvenement();
  const { params, bind } = binder();
  return q<AlertEventRow>(
    `select ev.* from (
       select ae.id::int as id, ae.rule_id::int as rule_id, ae.fired_at, ae.value,
              ae.message, ae.acknowledged, ae.severity,
              (select count(*) from alert_delivery d
                where d.alert_event_id = ae.id and d.status = 'delivered')::int as delivered,
              (select count(*) from alert_delivery d
                where d.alert_event_id = ae.id and d.status = 'sent')::int as pending,
              coalesce(r.metric, s.metric) as metric,
              ${sources.app} as app_id,
              coalesce(r.route, s.route) as route
       from alert_event ae
       ${sources.jointures}
     ) ev
     where true${compileScope(queryOf(f), "ev.app_id", bind)}
     order by ev.fired_at desc
     limit 100`,
    params,
  );
}

export async function unackedAlertCount(f: FiltersLike): Promise<number> {
  const sources = await sourcesEvenement();
  const { params, bind } = binder();
  const [r] = await q<{ n: number }>(
    `select count(*)::int as n
     from (
       select ${sources.app} as app_id
       from alert_event ae
       ${sources.jointures}
       where not ae.acknowledged
     ) ev
     where true${compileScope(queryOf(f), "ev.app_id", bind)}`,
    params,
  );
  return r?.n ?? 0;
}


export interface RuleInput {
  app_id: string;
  metric: string;
  route: string | null;
  comparator: string;
  threshold: number;
  window_minutes: number;
  webhook_url: string | null;
  mode: string;
  severity: string;
  sensitivity: number;
  baseline_weeks: number;
  /** Seulement pour issue:<uuid> ; null ailleurs. */
  env: string | null;
}

/**
 * migration-v73 appliquée ? Sans elle, ni la colonne `env` ni la famille issue
 * n'existent : une règle d'issue est refusée plutôt qu'écrite sans être évaluée.
 * Avec elle, l'issue doit appartenir à l'app de la règle.
 */
async function regleV73(r: RuleInput): Promise<boolean> {
  const [schema] = await q<{ v73: boolean }>(
    "select to_regclass('public.error_issue_notification') is not null as v73",
  );
  const v73 = schema?.v73 === true;
  if (r.metric.startsWith("issue:")) {
    if (!v73) throw new Error("alerte d'issue indisponible : migration-v73 non appliquée");
    const [issue] = await q("select 1 from error_issue where app_id = $1 and id = $2", [r.app_id, r.metric.slice(6)]);
    if (!issue) throw new Error(`issue inconnue dans l'app ${r.app_id}`);
  }
  return v73;
}

export async function insertAlertRule(r: RuleInput): Promise<void> {
  const v73 = await regleV73(r);
  await q(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes,
                             webhook_url, mode, severity, sensitivity, baseline_weeks${v73 ? ", env" : ""})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${v73 ? ", $12" : ""})`,
    [r.app_id, r.metric, r.route, r.comparator, r.threshold, r.window_minutes,
     r.webhook_url, r.mode, r.severity, r.sensitivity, r.baseline_weeks, ...(v73 ? [r.env] : [])],
  );
}

export async function updateAlertRule(id: number, r: RuleInput): Promise<void> {
  const v73 = await regleV73(r);
  await q(
    `update alert_rule
     set app_id = $2, metric = $3, route = $4, comparator = $5,
         threshold = $6, window_minutes = $7, webhook_url = $8,
         mode = $9, severity = $10, sensitivity = $11, baseline_weeks = $12${v73 ? ", env = $13" : ""}
     where id = $1`,
    [id, r.app_id, r.metric, r.route, r.comparator, r.threshold, r.window_minutes,
     r.webhook_url, r.mode, r.severity, r.sensitivity, r.baseline_weeks, ...(v73 ? [r.env] : [])],
  );
}

/** Bascule activation/désactivation (flip en SQL : pas d'état à transporter dans le form). */
export async function toggleAlertRuleActive(id: number): Promise<void> {
  await q(`update alert_rule set active = not active where id = $1`, [id]);
}

export async function acknowledgeAlertEvent(id: number): Promise<void> {
  await q(`update alert_event set acknowledged = true where id = $1`, [id]);
}

/** Évaluation immédiate des règles (même fonction SQL que pg_cron en cloud). */
export async function runCheckAlerts(): Promise<number> {
  const [r] = await q<{ fired: number }>(`select check_alerts() as fired`);
  return r?.fired ?? 0;
}

/** Routage immédiat des notifications d'issue en attente (étape du tick) ; sans effet avant migration-v73. */
export async function runRouteIssueNotifications(): Promise<void> {
  const [schema] = await q<{ v73: boolean }>(
    "select to_regprocedure('route_error_issue_notifications(integer)') is not null as v73",
  );
  if (schema?.v73) await q("select route_error_issue_notifications()");
}

/** Évaluation immédiate du burn-rate des SLO (même fonction SQL que pg_cron en cloud). */
export async function runCheckSloBurn(): Promise<number> {
  const [r] = await q<{ fired: number }>(`select check_slo_burn() as fired`);
  return r?.fired ?? 0;
}


// ---------------------------------------------------------------------------
// Corrélation v2 (cartes + série historisée + angles morts)
//
// Le côté RÉEL et le côté ROBOT sont chacun filtrés par le contrat commun : plage
// [from,to), périmètre d'apps, route ; le réel exclut aussi les bots et suit les
// dimensions de session. Le robot n'a ni appareil, ni pays, ni session : l'écran
// désactive ces filtres (lib/surfaces.ts) plutôt que d'en afficher un qui
// n'agirait que sur une moitié de la comparaison. Les vues historiques
// v_correlation / v_blind_spot, sans plage ni bots, ne sont plus lues ici.
// ---------------------------------------------------------------------------

export interface CorrCardRow {
  app_id: string;
  route: string | null;
  rum_lcp_p75: number | null;
  rum_inp_p75: number | null;
  rum_sessions: number | null;
  syn_latency_avg: number | null;
  syn_score_avg: number | null;
  syn_state: string | null;
  syn_measures: string | null;
}

/** CTE `rum` et `syn` filtrées ; `grain` ajoute le seau horaire aligné UTC. */
function correlationSources(sql: SqlContext, grain: "fenetre" | "heure"): string {
  const reel = sql.where({ dataset: "vitals", row: "m", session: "ms", time: "m.ts" });
  const robot = sql.where({ dataset: "synthetic", row: "y", time: "y.captured_at" });
  const horaire = { ...sql.query.range, bucketSeconds: 3600 };
  const seauReel = grain === "heure" ? `, ${bucketExpr("m.ts", horaire)} as bucket` : "";
  const seauRobot = grain === "heure" ? `, ${bucketExpr("y.captured_at", horaire)} as bucket` : "";
  const groupe = grain === "heure" ? "1, 2, 3" : "1, 2";
  return `rum as (
       select m.app_id, m.route${seauReel},
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as rum_lcp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as rum_inp_p75,
              count(distinct m.session_id)::int as rum_sessions
       from rum_metric m
       ${sessionJoin("m", "ms")}
       where true${reel}
       group by ${groupe}
     ),
     syn as (
       select y.app_id, y.route_hint as route${seauRobot},
              avg(y.latency_ms) as syn_latency_avg,
              avg(y.score) as syn_score_avg,
              case max(case y.state when 'incident' then 3 when 'warn' then 2 when 'ok' then 1 else 0 end)
                when 3 then 'incident' when 2 then 'warn' when 1 then 'ok' end as syn_state,
              string_agg(distinct y.measure_name, ', ') as syn_measures
       from syn_snapshot y
       where true${robot}
       group by ${groupe}
     )`;
}

/** Agrégats robot vs réel par app/route sur la plage — chacun calculé de son côté. */
export async function correlationCards(f: FiltersLike): Promise<CorrCardRow[]> {
  const sql = await sqlContext(f);
  return q<CorrCardRow>(
    `with ${correlationSources(sql, "fenetre")}
     select coalesce(r.app_id, s.app_id) as app_id, coalesce(r.route, s.route) as route,
            r.rum_lcp_p75, r.rum_inp_p75, r.rum_sessions,
            s.syn_latency_avg, s.syn_score_avg, s.syn_state, s.syn_measures
     from rum r full outer join syn s using (app_id, route)
     order by (r.rum_lcp_p75 is not null and s.syn_latency_avg is not null) desc, app_id, route`,
    sql.params,
  );
}

/** Routes disposant à la fois de données robot ET réel sur la plage (pour le sélecteur). */
export async function correlationRoutes(f: FiltersLike): Promise<string[]> {
  const sql = await sqlContext(f);
  const rows = await q<{ route: string }>(
    `with ${correlationSources(sql, "heure")}
     select coalesce(r.route, s.route) as route
       from rum r full outer join syn s using (app_id, route, bucket)
      where coalesce(r.route, s.route) is not null
      group by 1
     having count(r.rum_lcp_p75) > 0 and count(s.syn_latency_avg) > 0
      order by 1`,
    sql.params,
  );
  return rows.map((r) => r.route);
}

export interface CorrSeriesRow {
  bucket: Date;
  rum_lcp_p75: number | null;
  syn_latency_avg: number | null;
}

/** Série horaire robot vs réel pour une route, sur la plage (seaux horaires alignés UTC). */
export async function correlationSeries(route: string, f: FiltersLike): Promise<CorrSeriesRow[]> {
  const sql = await sqlContext(f);
  const sources = correlationSources(sql, "heure");
  const cible = sql.bind(route);
  return q<CorrSeriesRow>(
    `with ${sources}
     select coalesce(r.bucket, s.bucket) as bucket, r.rum_lcp_p75, s.syn_latency_avg
       from (select * from rum where route = ${cible}) r
       full outer join (select * from syn where route = ${cible}) s using (app_id, route, bucket)
      order by 1`,
    sql.params,
  );
}

export interface BlindSpotRow {
  app_id: string;
  route: string | null;
  bucket: Date;
  rum_lcp_p75: number;
  syn_latency_avg: number;
  syn_state: string;
  gap_ms: number;
}

/**
 * Angles morts : robot « ok » mais LCP p75 réel au-dessus de la borne « Bon »
 * (`THRESHOLDS.LCP[0]`, donc « À améliorer » ou « Mauvais » pour `rating2026`) sur
 * une même heure et une même route, écart décroissant. Pas « poor » : un LCP de
 * 3 s est « À améliorer », et c'est déjà un angle mort du robot.
 */
export async function blindSpots(f: FiltersLike): Promise<BlindSpotRow[]> {
  const sql = await sqlContext(f);
  const sources = correlationSources(sql, "heure");
  const borneBon = sql.bind(THRESHOLDS.LCP[0]);
  return q<BlindSpotRow>(
    `with ${sources}
     select r.app_id, r.route, r.bucket, r.rum_lcp_p75, s.syn_latency_avg, s.syn_state,
            round((r.rum_lcp_p75 - s.syn_latency_avg)::numeric)::int as gap_ms
       from rum r join syn s using (app_id, route, bucket)
      where s.syn_state = 'ok' and r.rum_lcp_p75 > ${borneBon}::float8 and s.syn_latency_avg is not null
      order by gap_ms desc
      limit 50`,
    sql.params,
  );
}
