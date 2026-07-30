// Requêtes SQL v0.3 (chantier A4) : groupes d'erreurs, alerting, corrélation v2.
// Lit les filtres globaux (app/period/device) de façon défensive — défauts app='all', period=24h.
import { q } from "./db";

// ---------------------------------------------------------------------------
// Filtres globaux — MODÈLE HISTORIQUE « v2 » (app/period/device)
//
// ⚠️ DETTE CONNUE : il existe DEUX modèles de filtres dans le repo, aux
// sémantiques différentes, tous deux vivants :
//   • ./filters.ts    → app: string | null  (null = toutes), device union stricte.
//                        Utilisé par : home, sessions, pages, tracing, ux,
//                        dashboards, admin/* et les lib queries*.ts (sauf ici).
//   • ce fichier      → app: string ('all' = toutes), device: string (+ 'tablet').
//                        Utilisé par : errors, correlation, alerts, slo.
//
// Le SQL d'ici compare littéralement `= 'all'` (cf. clauses ci-dessous), alors
// que ./filters.ts s'appuie sur `is null`. Unifier les deux (sur le modèle
// null de filters.ts) est un SUIVI volontairement différé : il réécrit la
// sémantique WHERE de ~6 pages et touche le filtrage en prod — à faire dans
// un chantier dédié, vérifié page par page. En attendant, ne PAS mélanger les
// deux `Filters` : chaque page importe celui qui correspond à ses requêtes.
// ---------------------------------------------------------------------------

export type SearchParams = Record<string, string | string[] | undefined>;

const PERIODS = {
  "1h": { interval: "1 hour", label: "1 h" },
  "24h": { interval: "24 hours", label: "24 h" },
  "7d": { interval: "7 days", label: "7 j" },
} as const;
export type PeriodKey = keyof typeof PERIODS;

const DEVICES = ["mobile", "desktop", "tablet"] as const;

export interface Filters {
  app: string; // 'all' = toutes les apps
  period: PeriodKey;
  device: string; // 'all' = tous les devices
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Lecture défensive des searchParams (jamais d'exception, valeurs sûres pour le SQL). */
export function parseFilters(sp?: SearchParams): Filters {
  const rawPeriod = (first(sp?.period) ?? "24h").toLowerCase().replace("7j", "7d");
  const device = first(sp?.device) ?? "all";
  return {
    app: first(sp?.app)?.trim() || "all",
    period: (rawPeriod in PERIODS ? rawPeriod : "24h") as PeriodKey,
    device: (DEVICES as readonly string[]).includes(device) ? device : "all",
  };
}

export function periodInterval(f: Filters): string {
  return PERIODS[f.period].interval;
}

export function periodLabel(f: Filters): string {
  return PERIODS[f.period].label;
}


/** Query string préservant les filtres actifs pour les liens internes. */
export function filtersToQuery(f: Filters, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  if (f.app !== "all") p.set("app", f.app);
  if (f.period !== "24h") p.set("period", f.period);
  if (f.device !== "all") p.set("device", f.device);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Erreurs groupées par fingerprint (vue v_error_group)
// ---------------------------------------------------------------------------

/** Statuts de triage d'un groupe d'erreurs — allow-list TS (pas de CHECK en base). */
export const ERROR_STATUSES = ["open", "resolved", "ignored"] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export interface ErrorGroupRow {
  app_id: string;
  fingerprint: string;
  error_type: string | null;
  sample_message: string | null;
  occurrences: number;
  sessions: number;
  users_affected: number;
  first_seen: Date;
  last_seen: Date;
  status: ErrorStatus;
  resolved_at: Date | null;
  /** true si une erreur marquée « résolue » réapparaît (last_seen > resolved_at). */
  regressed: boolean;
}

// SELECT commun (liste + détail) : v_error_group_ext (occurrences/sessions/users)
// ⟕ error_status ; statut par défaut 'open', régression dérivée à la lecture.
const ERROR_GROUP_SELECT = `
  select g.app_id, g.fingerprint, g.error_type, g.sample_message,
         g.occurrences::int as occurrences, g.sessions::int as sessions,
         g.users_affected::int as users_affected, g.first_seen, g.last_seen,
         coalesce(st.status, 'open') as status,
         st.resolved_at,
         (st.status = 'resolved' and g.last_seen > st.resolved_at) as regressed
  from v_error_group_ext g
  left join error_status st on st.app_id = g.app_id and st.fingerprint = g.fingerprint`;

// Tri triage : régressions d'abord, puis ouvertes, puis résolues, puis ignorées.
const ERROR_GROUP_ORDER = `
  order by (case
    when (st.status = 'resolved' and g.last_seen > st.resolved_at) then 0
    when coalesce(st.status, 'open') = 'open' then 1
    when coalesce(st.status, 'open') = 'ignored' then 3
    else 2 end),
    g.occurrences desc, g.last_seen desc`;

export async function errorGroups(
  f: Filters,
  page?: { limit?: number; offset?: number },
): Promise<ErrorGroupRow[]> {
  const limit = page?.limit ?? 100;
  const offset = page?.offset ?? 0;
  return q<ErrorGroupRow>(
    `${ERROR_GROUP_SELECT}
     where ($1 = 'all' or g.app_id = $1)
       and g.last_seen > now() - $2::interval
     ${ERROR_GROUP_ORDER}
     limit $3 offset $4`,
    [f.app, periodInterval(f), limit, offset],
  );
}

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

/** Occurrences par heure sur 24 h, par fingerprint → tableaux de 24 buckets pour les sparklines. */
export async function errorSparklines(
  fingerprints: string[],
  f: Filters,
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (!fingerprints.length) return map;
  const rows = await q<{ fingerprint: string; bucket: Date; n: number }>(
    `select fingerprint, date_trunc('hour', ts) as bucket, count(*)::int as n
     from rum_error
     where fingerprint = any($1)
       and ts > now() - interval '24 hours'
       and ($2 = 'all' or app_id = $2)
     group by 1, 2`,
    [fingerprints, f.app],
  );
  const now = Date.now();
  for (const fp of fingerprints) map.set(fp, new Array(24).fill(0));
  for (const r of rows) {
    const idx = 23 - Math.floor((now - new Date(r.bucket).getTime()) / 3_600_000);
    if (idx >= 0 && idx < 24) map.get(r.fingerprint)![idx] += r.n;
  }
  return map;
}

/** Erreurs v0.1 sans fingerprint (non groupables) — affiché en note de bas de page. */
export async function unfingerprintedCount(f: Filters): Promise<number> {
  const [r] = await q<{ n: number }>(
    `select count(*)::int as n
     from rum_error
     where fingerprint is null
       and ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval`,
    [f.app, periodInterval(f)],
  );
  return r?.n ?? 0;
}

export interface ErrorSample {
  message: string | null;
  error_type: string | null;
  kind: string | null;
  stack: string | null;
  source: string | null;
  lineno: number | null;
  colno: number | null;
  route: string | null;
  session_id: string | null;
  release: string | null;
  ts: Date;
}

export interface ErrorOccurrence {
  id: number;
  ts: Date;
  route: string | null;
  session_id: string | null;
  kind: string | null;
  message: string | null;
  device_type: string | null;
}

export interface ErrorGroupDetail {
  group: ErrorGroupRow;
  last: ErrorSample | null;
  occurrences: ErrorOccurrence[];
}

export async function errorGroupDetail(
  fingerprint: string,
  f: Filters,
): Promise<ErrorGroupDetail | null> {
  const [group] = await q<ErrorGroupRow>(
    `${ERROR_GROUP_SELECT}
     where g.fingerprint = $1 and ($2 = 'all' or g.app_id = $2)
     limit 1`,
    [fingerprint, f.app],
  );
  if (!group) return null;
  const [last] = await q<ErrorSample>(
    `select message, error_type, kind, stack, source, lineno, colno, route, session_id, release, ts
     from rum_error
     where fingerprint = $1 and ($2 = 'all' or app_id = $2)
     order by ts desc limit 1`,
    [fingerprint, f.app],
  );
  const occurrences = await q<ErrorOccurrence>(
    `select e.id::int as id, e.ts, e.route, e.session_id, e.kind, e.message, s.device_type
     from rum_error e
     left join rum_session s using (session_id)
     where e.fingerprint = $1
       and ($2 = 'all' or e.app_id = $2)
       and ($3 = 'all' or s.device_type = $3)
     order by e.ts desc
     limit 100`,
    [fingerprint, f.app, f.device],
  );
  return { group, last: last ?? null, occurrences };
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
// check_alerts (migration-v38).
export const ALERT_METRICS = [...SLO_METRICS, "log_errors"] as const;
export const ALERT_COMPARATORS = [">", "<"] as const;

/** Libellé lisible + unité d'une métrique d'alerte/SLO (dropdowns, feed d'événements). */
export const METRIC_LABELS: Record<string, string> = {
  LCP: "LCP (ms)",
  INP: "INP (ms)",
  CLS: "CLS",
  FCP: "FCP (ms)",
  TTFB: "TTFB (ms)",
  error_rate: "Taux d'erreur JS",
  log_errors: "Logs ERROR (nombre)",
};

/** Libellé d'une métrique (repli : la clé brute si inconnue). */
export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
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
}

export async function alertRules(f: Filters): Promise<AlertRuleRow[]> {
  return q<AlertRuleRow>(
    `select r.id::int as id, r.app_id, r.metric, r.route, r.comparator, r.threshold,
            r.window_minutes, r.webhook_url, r.active, r.created_at,
            r.mode, r.severity, r.sensitivity, r.baseline_weeks,
            (select count(*)::int from alert_event ae
              where ae.rule_id = r.id and not ae.acknowledged) as unacked
     from alert_rule r
     where ($1 = 'all' or r.app_id = $1)
     order by r.id desc`,
    [f.app],
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

/** Un événement vient d'une règle OU d'un SLO : left joins + coalesce des champs.
 *  `delivered` compte les livraisons effectives — sans lui, l'interface affichait
 *  une alerte « déclenchée » sans dire qu'elle n'avait atteint personne. */
export async function alertEvents(f: Filters): Promise<AlertEventRow[]> {
  return q<AlertEventRow>(
    `select ae.id::int as id, ae.rule_id::int as rule_id, ae.fired_at, ae.value,
            ae.message, ae.acknowledged, ae.severity,
            (select count(*) from alert_delivery d
              where d.alert_event_id = ae.id and d.status = 'delivered')::int as delivered,
            (select count(*) from alert_delivery d
              where d.alert_event_id = ae.id and d.status = 'sent')::int as pending,
            coalesce(r.metric, s.metric) as metric,
            coalesce(r.app_id, s.app_id) as app_id,
            coalesce(r.route, s.route) as route
     from alert_event ae
     left join alert_rule r on r.id = ae.rule_id
     left join slo s on s.id = ae.slo_id
     where ($1 = 'all' or coalesce(r.app_id, s.app_id) = $1)
     order by ae.fired_at desc
     limit 100`,
    [f.app],
  );
}

export async function unackedAlertCount(f: Filters): Promise<number> {
  const [r] = await q<{ n: number }>(
    `select count(*)::int as n
     from alert_event ae
     left join alert_rule r on r.id = ae.rule_id
     left join slo s on s.id = ae.slo_id
     where not ae.acknowledged and ($1 = 'all' or coalesce(r.app_id, s.app_id) = $1)`,
    [f.app],
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
}

export async function insertAlertRule(r: RuleInput): Promise<void> {
  await q(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes,
                             webhook_url, mode, severity, sensitivity, baseline_weeks)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [r.app_id, r.metric, r.route, r.comparator, r.threshold, r.window_minutes,
     r.webhook_url, r.mode, r.severity, r.sensitivity, r.baseline_weeks],
  );
}

export async function updateAlertRule(id: number, r: RuleInput): Promise<void> {
  await q(
    `update alert_rule
     set app_id = $2, metric = $3, route = $4, comparator = $5,
         threshold = $6, window_minutes = $7, webhook_url = $8,
         mode = $9, severity = $10, sensitivity = $11, baseline_weeks = $12
     where id = $1`,
    [id, r.app_id, r.metric, r.route, r.comparator, r.threshold, r.window_minutes,
     r.webhook_url, r.mode, r.severity, r.sensitivity, r.baseline_weeks],
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

/** Évaluation immédiate du burn-rate des SLO (même fonction SQL que pg_cron en cloud). */
export async function runCheckSloBurn(): Promise<number> {
  const [r] = await q<{ fired: number }>(`select check_slo_burn() as fired`);
  return r?.fired ?? 0;
}

// ---------------------------------------------------------------------------
// Corrélation v2 (cartes + série historisée + angles morts)
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

/** Agrégats robot vs réel par app/route — robot et réel calculés chacun de leur côté. */
export async function correlationCards(f: Filters): Promise<CorrCardRow[]> {
  return q<CorrCardRow>(
    `with rum as (
       select app_id, route,
              percentile_cont(0.75) within group (order by value) filter (where name = 'LCP') as rum_lcp_p75,
              percentile_cont(0.75) within group (order by value) filter (where name = 'INP') as rum_inp_p75,
              count(distinct session_id)::int as rum_sessions
       from rum_metric
       where ts > now() - $1::interval
       group by 1, 2
     ),
     syn as (
       select app_id, route_hint as route,
              avg(latency_ms) as syn_latency_avg,
              avg(score) as syn_score_avg,
              case max(case state when 'incident' then 3 when 'warn' then 2 when 'ok' then 1 else 0 end)
                when 3 then 'incident' when 2 then 'warn' when 1 then 'ok' end as syn_state,
              string_agg(distinct measure_name, ', ') as syn_measures
       from syn_snapshot
       where captured_at > now() - $1::interval
       group by 1, 2
     )
     select coalesce(r.app_id, s.app_id) as app_id, coalesce(r.route, s.route) as route,
            r.rum_lcp_p75, r.rum_inp_p75, r.rum_sessions,
            s.syn_latency_avg, s.syn_score_avg, s.syn_state, s.syn_measures
     from rum r full outer join syn s using (app_id, route)
     where ($2 = 'all' or coalesce(r.app_id, s.app_id) = $2)
     order by (r.rum_lcp_p75 is not null and s.syn_latency_avg is not null) desc, app_id, route`,
    [periodInterval(f), f.app],
  );
}

/** Routes disposant à la fois de données robot ET réel sur la période (pour le sélecteur). */
export async function correlationRoutes(f: Filters): Promise<string[]> {
  const rows = await q<{ route: string }>(
    `select route
     from v_correlation
     where route is not null
       and bucket > now() - $1::interval
       and ($2 = 'all' or app_id = $2)
     group by route
     having count(rum_lcp_p75) > 0 and count(syn_latency_avg) > 0
     order by route`,
    [periodInterval(f), f.app],
  );
  return rows.map((r) => r.route);
}

export interface CorrSeriesRow {
  bucket: Date;
  rum_lcp_p75: number | null;
  syn_latency_avg: number | null;
}

/** Série temporelle historisée robot vs réel pour une route (buckets horaires de v_correlation). */
export async function correlationSeries(route: string, f: Filters): Promise<CorrSeriesRow[]> {
  return q<CorrSeriesRow>(
    `select bucket, rum_lcp_p75, syn_latency_avg
     from v_correlation
     where route = $1
       and ($2 = 'all' or app_id = $2)
       and bucket > now() - $3::interval
     order by bucket`,
    [route, f.app, periodInterval(f)],
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

/** Angles morts : robot=ok mais réel=poor (vue v_blind_spot), triés par écart décroissant. */
export async function blindSpots(f: Filters): Promise<BlindSpotRow[]> {
  return q<BlindSpotRow>(
    `select app_id, route, bucket, rum_lcp_p75, syn_latency_avg, syn_state, gap_ms::int as gap_ms
     from v_blind_spot
     where ($1 = 'all' or app_id = $1)
       and bucket > now() - $2::interval
     order by gap_ms desc
     limit 50`,
    [f.app, periodInterval(f)],
  );
}
