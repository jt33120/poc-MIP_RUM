// Requêtes SQL v0.3 (chantier A4) : triage des erreurs, alerting, corrélation v2.
import { ALERT_SEVERITIES } from "./alerting";
import { q } from "./db";
import { periodOf, queryOf, type FiltersLike } from "./filters";
import { isValidEventName } from "./queries-events";
import { binder, bucketExpr, compileScope, sessionJoin } from "./query-compiler";
import type { AnalyticsQuery } from "./query-contract";
import { sqlContext, type SqlContext } from "./query-sql";
import { ecrireSerie } from "./correlation-serie";
import { THRESHOLDS, type Rating } from "./rating";

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
  /** SLO dont le burn rapide a déclenché l'événement (`check_slo_burn`) ; null sinon. */
  slo_id: number | null;
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
async function sourcesEvenement(): Promise<{ jointures: string; app: string; issue: string }> {
  const [schema] = await q<{ v73: boolean }>(
    "select to_regclass('public.error_issue_notification') is not null as v73",
  );
  return schema?.v73
    ? {
        jointures: `left join alert_rule r on r.id = ae.rule_id
     left join slo s on s.id = ae.slo_id
     left join error_issue_notification n on n.alert_event_id = ae.id`,
        app: "coalesce(r.app_id, s.app_id, n.app_id)",
        issue: "n.issue_id::text",
      }
    : {
        jointures: `left join alert_rule r on r.id = ae.rule_id
     left join slo s on s.id = ae.slo_id`,
        app: "coalesce(r.app_id, s.app_id)",
        issue: "null::text",
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
       select ae.id::int as id, ae.rule_id::int as rule_id, ae.slo_id::int as slo_id, ae.fired_at, ae.value,
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

// ---------------------------------------------------------------------------
// Déclenchements sur une fenêtre FIXE de jours (F62) : l'histogramme par jour et
// la frise par source ne lisent plus les 100 derniers événements en mémoire, mais
// tous ceux de la fenêtre, en SQL. La plage de l'écran ne s'y applique pas : une
// alerte a été évaluée sur la fenêtre de sa règle, pas sur celle de l'écran.
// ---------------------------------------------------------------------------

/**
 * Premier jour (minuit UTC, `timestamp` sans fuseau) d'une fenêtre de `jours` jours
 * calendaires UTC qui finit aujourd'hui, jour en cours compris. Calculé en temps
 * UTC « nu » : ajouter un jour à un `timestamptz` se fait dans le fuseau de la
 * session, et une journée de changement d'heure y durerait 23 ou 25 h.
 */
function premierJourUtc(jours: string): string {
  return `(date_trunc('day', now() at time zone 'utc') - make_interval(days => ${jours}::int - 1))`;
}

function joursValides(jours: number): number {
  if (!Number.isSafeInteger(jours) || jours < 1 || jours > 366) throw new Error(`fenêtre de jours invalide : ${jours}`);
  return jours;
}

export interface AlertDayRow {
  /** Jour UTC, `AAAA-MM-JJ` (texte : un `date` arriverait en Date à minuit LOCAL). */
  jour: string;
  severity: string;
  /** Déclenchements du jour et de cette sévérité ; 0 pour un jour sans événement. */
  n: number;
  /** Dont sans livraison réussie NI en attente : personne n'a été averti. */
  non_livres: number;
}

/**
 * Déclenchements par jour UTC × sévérité sur `jours` jours fixes (A5, § 5.19) :
 * compte exact en SQL, jours vides à 0 (`generate_series`), chaque sévérité connue
 * (`ALERT_SEVERITIES`) présente chaque jour. Mêmes sources d'événement et même
 * périmètre que `alertEvents` ; même définition de la livraison (v49) : un
 * événement dont une livraison est « sent » (en attente) n'est PAS non livré.
 */
export async function alertEventsByDay(f: FiltersLike, jours = 30): Promise<AlertDayRow[]> {
  const sources = await sourcesEvenement();
  const sql = await sqlContext(f);
  const n = sql.bind(joursValides(jours));
  const severites = sql.bind([...ALERT_SEVERITIES]);
  const perimetre = compileScope(sql.query, "ev.app_id", sql.bind);
  return q<AlertDayRow>(
    `with bornes as (select ${premierJourUtc(n)} as jour0),
     ev as (
       select ev.* from (
         select ${sources.app} as app_id, ae.fired_at, ae.severity,
                exists (select 1 from alert_delivery d
                         where d.alert_event_id = ae.id and d.status in ('delivered', 'sent')) as averti
           from alert_event ae
           ${sources.jointures}
          where ae.fired_at >= (select jour0 at time zone 'utc' from bornes)
       ) ev
       where true${perimetre}
     ),
     jours as (
       select generate_series(b.jour0, b.jour0 + make_interval(days => ${n}::int - 1), interval '1 day') as jour
         from bornes b
     ),
     severites as (
       select unnest(${severites}::text[]) as severity
       union
       select distinct severity from ev
     )
     select to_char(j.jour, 'YYYY-MM-DD') as jour, s.severity,
            count(ev.fired_at)::int as n,
            (count(ev.fired_at) filter (where not ev.averti))::int as non_livres
       from jours j
      cross join severites s
       left join ev on ev.severity = s.severity
                   and ev.fired_at >= j.jour at time zone 'utc'
                   and ev.fired_at < (j.jour + interval '1 day') at time zone 'utc'
      group by j.jour, s.severity
      order by j.jour, s.severity`,
    sql.params,
  );
}

/** Déclenchements sans livraison réussie ni en attente sur la fenêtre (A2) : somme exacte. */
export function totalNonLivres(parJour: readonly Pick<AlertDayRow, "non_livres">[]): number {
  return parJour.reduce((total, j) => total + j.non_livres, 0);
}

/**
 * Source d'un déclenchement, dans cet ordre : sa règle (y compris une règle
 * `issue:<uuid>`), son SLO, la notification d'issue qui l'a produit (v73). Reste
 * `nouvelle_erreur` : l'alerte « nouvelle erreur » de `check_new_errors`, sans
 * règle, sans SLO ni issue — elle existe en base, elle a sa piste.
 */
export type SourceDeclenchement = "regle" | "slo" | "issue" | "nouvelle_erreur";

export interface AlertFiringRow {
  source: SourceDeclenchement;
  /** Identifiant de la règle, du SLO ou de l'issue ; « nouvelles-erreurs » pour la piste sans source. */
  source_id: string;
  libelle: string;
  fired_at: Date;
  severity: string;
  delivered: number;
  pending: number;
  acknowledged: boolean;
  event_id: number;
}

/**
 * Déclenchements des `jours` jours fixes, par source (A5, frise) : les plus récents
 * d'abord, `plafond` au plus ; `tronque` dit qu'il y en avait davantage. Mêmes
 * sources, périmètre et livraisons que `alertEvents`.
 */
export async function alertFirings(
  f: FiltersLike,
  jours = 30,
  plafond = 2000,
): Promise<{ lignes: AlertFiringRow[]; tronque: boolean }> {
  if (!Number.isSafeInteger(plafond) || plafond < 1) throw new Error(`plafond invalide : ${plafond}`);
  const sources = await sourcesEvenement();
  const sql = await sqlContext(f);
  const n = sql.bind(joursValides(jours));
  const perimetre = compileScope(sql.query, "ev.app_id", sql.bind);
  const limite = sql.bind(plafond + 1);
  const rows = await q<{
    event_id: number;
    fired_at: Date;
    severity: string;
    acknowledged: boolean;
    rule_id: string | null;
    slo_id: string | null;
    issue_id: string | null;
    rule_metric: string | null;
    rule_route: string | null;
    slo_name: string | null;
    delivered: number;
    pending: number;
  }>(
    `select ev.* from (
       select ae.id::int as event_id, ae.fired_at, ae.severity, ae.acknowledged,
              ae.rule_id::text as rule_id, ae.slo_id::text as slo_id, ${sources.issue} as issue_id,
              r.metric as rule_metric, r.route as rule_route, s.name as slo_name,
              (select count(*) from alert_delivery d
                where d.alert_event_id = ae.id and d.status = 'delivered')::int as delivered,
              (select count(*) from alert_delivery d
                where d.alert_event_id = ae.id and d.status = 'sent')::int as pending,
              ${sources.app} as app_id
         from alert_event ae
         ${sources.jointures}
        where ae.fired_at >= ${premierJourUtc(n)} at time zone 'utc'
     ) ev
     where true${perimetre}
     order by ev.fired_at desc, ev.event_id desc
     limit ${limite}`,
    sql.params,
  );
  const lignes = rows.slice(0, plafond).map((r): AlertFiringRow => {
    const commun = {
      fired_at: r.fired_at,
      severity: r.severity,
      delivered: r.delivered,
      pending: r.pending,
      acknowledged: r.acknowledged,
      event_id: r.event_id,
    };
    if (r.rule_id !== null) {
      const libelle = `${metricLabel(r.rule_metric ?? "")}${r.rule_route ? ` · ${r.rule_route}` : ""}`;
      return { source: "regle", source_id: r.rule_id, libelle, ...commun };
    }
    if (r.slo_id !== null) return { source: "slo", source_id: r.slo_id, libelle: r.slo_name ?? `SLO ${r.slo_id}`, ...commun };
    if (r.issue_id !== null) return { source: "issue", source_id: r.issue_id, libelle: `Issue ${r.issue_id.slice(0, 8)}`, ...commun };
    return { source: "nouvelle_erreur", source_id: "nouvelles-erreurs", libelle: "Nouvelles erreurs (sans issue)", ...commun };
  });
  return { lignes, tronque: rows.length > plafond };
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
  /** Mesures LCP réelles de la plage : l'effectif du p75 et le poids de la route
   *  (additif entre routes, contrairement aux sessions). `null` : aucun côté réel. */
  rum_lcp_n: number | null;
  syn_latency_avg: number | null;
  syn_score_avg: number | null;
  syn_state: string | null;
  syn_measures: string | null;
}

/**
 * Effectif minimal d'une heure × (app, route) pour que son LCP p75 réel entre dans
 * un verdict robot / réel (matrice de concordance, angles morts). En dessous, un
 * p75 horaire tient à quelques visites : il est compté à part, « réel insuffisant ».
 */
export const EFFECTIF_MIN_HEURE = 30;

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
              count(distinct m.session_id)::int as rum_sessions,
              count(*) filter (where m.name = 'LCP')::int as rum_lcp_n
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
            r.rum_lcp_p75, r.rum_inp_p75, r.rum_sessions, r.rum_lcp_n,
            s.syn_latency_avg, s.syn_score_avg, s.syn_state, s.syn_measures
     from rum r full outer join syn s using (app_id, route)
     order by (r.rum_lcp_p75 is not null and s.syn_latency_avg is not null) desc, app_id, route`,
    sql.params,
  );
}

/**
 * Couples (app, route) disposant à la fois de données robot ET réel sur la plage
 * (options du sélecteur du hero, CR7-a). Un COUPLE, pas une route : sous `app=all`,
 * deux apps qui ont chacune `/checkout` donnent deux options.
 */
export async function correlationRoutes(f: FiltersLike): Promise<{ app_id: string; route: string }[]> {
  const sql = await sqlContext(f);
  return q<{ app_id: string; route: string }>(
    `with ${correlationSources(sql, "heure")}
     select coalesce(r.app_id, s.app_id) as app_id, coalesce(r.route, s.route) as route
       from rum r full outer join syn s using (app_id, route, bucket)
      where coalesce(r.route, s.route) is not null
      group by 1, 2
     having count(r.rum_lcp_p75) > 0 and count(s.syn_latency_avg) > 0
      order by 2, 1`,
    sql.params,
  );
}

export interface CorrSeriesRow {
  bucket: Date;
  rum_lcp_p75: number | null;
  /** Mesures LCP de l'heure (effectif du point) ; `null` : aucune mesure réelle. */
  rum_lcp_n: number | null;
  syn_latency_avg: number | null;
  /** Pire état robot de l'heure ; `null` : aucun passage, ou état non renseigné. */
  syn_state: "ok" | "warn" | "incident" | null;
  syn_measures: string | null;
}

/**
 * Série horaire robot et réel d'UN couple (app, route), sur la plage (seaux d'une
 * heure alignés UTC). L'app et la route s'ajoutent au périmètre compilé : une app
 * hors périmètre rend 0 ligne. Seules les heures où au moins un côté a mesuré sont
 * rendues : l'appelant aligne sur la grille horaire avant de tracer, sinon une
 * heure vide relierait ses voisines.
 */
export async function correlationSeries(app: string, route: string, f: FiltersLike): Promise<CorrSeriesRow[]> {
  const sql = await sqlContext(f);
  const sources = correlationSources(sql, "heure");
  const cibleApp = sql.bind(app);
  const cibleRoute = sql.bind(route);
  return q<CorrSeriesRow>(
    `with ${sources}
     select coalesce(r.bucket, s.bucket) as bucket, r.rum_lcp_p75, r.rum_lcp_n,
            s.syn_latency_avg, s.syn_state, s.syn_measures
       from (select * from rum where app_id = ${cibleApp} and route = ${cibleRoute}) r
       full outer join (select * from syn where app_id = ${cibleApp} and route = ${cibleRoute}) s using (bucket)
      order by 1`,
    sql.params,
  );
}

export interface BlindSpotRow {
  app_id: string;
  route: string | null;
  bucket: Date;
  rum_lcp_p75: number;
  /** Mesures LCP réelles de l'heure : au moins `EFFECTIF_MIN_HEURE`. */
  rum_lcp_n: number;
  syn_latency_avg: number;
  syn_state: string;
  /** Scénarios robot de l'heure (`measure_name`, séparés par des virgules). */
  syn_measures: string | null;
  gap_ms: number;
}

/**
 * Angles morts : robot « ok » mais LCP p75 réel au-dessus de la borne « Bon »
 * (`THRESHOLDS.LCP[0]`, donc « À améliorer » ou « Mauvais » pour `rating2026`) sur
 * une même heure et une même route, sur des heures d'au moins `effectifMin` mesures
 * LCP (même règle que `correlationConcordance`), écart décroissant. Pas « poor » : un
 * LCP de 3 s est « À améliorer », et c'est déjà un angle mort du robot.
 *
 * Plafonnée à 50 lignes : c'est une LISTE à ouvrir, jamais un compte. Le nombre
 * d'angles morts vient de `correlationConcordance`.
 */
export async function blindSpots(f: FiltersLike, effectifMin = EFFECTIF_MIN_HEURE): Promise<BlindSpotRow[]> {
  const sql = await sqlContext(f);
  const sources = correlationSources(sql, "heure");
  const borneBon = sql.bind(THRESHOLDS.LCP[0]);
  const effectif = sql.bind(effectifValide(effectifMin));
  return q<BlindSpotRow>(
    `with ${sources}
     select r.app_id, r.route, r.bucket, r.rum_lcp_p75, r.rum_lcp_n, s.syn_latency_avg, s.syn_state, s.syn_measures,
            round((r.rum_lcp_p75 - s.syn_latency_avg)::numeric)::int as gap_ms
       from rum r join syn s using (app_id, route, bucket)
      where s.syn_state = 'ok' and r.rum_lcp_p75 > ${borneBon}::float8 and s.syn_latency_avg is not null
        and r.rum_lcp_n >= ${effectif}::int
      order by gap_ms desc, r.app_id, r.route, r.bucket
      limit 50`,
    sql.params,
  );
}

function effectifValide(effectifMin: number): number {
  // Lié en paramètre, donc sans risque d'injection ; mais un NaN rendrait une
  // requête qui ne garde rien, et un 0 un verdict sur une heure sans mesure.
  if (!Number.isSafeInteger(effectifMin) || effectifMin < 1) throw new Error(`effectif minimal invalide : ${effectifMin}`);
  return effectifMin;
}

// ---------------------------------------------------------------------------
// Robot et réel (F57) : fraîcheur du robot, concordance des états par heure.
// ---------------------------------------------------------------------------

export interface SyntheticFreshnessRow {
  app_id: string;
  /** Dernier passage du robot sur la plage ; `null` : aucun passage. */
  dernier: Date | null;
  /** Intervalle médian entre deux passages d'un même scénario ; `null` : moins de deux. */
  intervalle_median_s: number | null;
  /** Exécutions de scénario sur la plage (lignes `syn_snapshot`). */
  passages: number;
}

/**
 * Fraîcheur du robot, par app, sur la plage : si le robot s'est arrêté, « robot ok »
 * ne veut plus rien dire, et l'écran doit le dire avant tout chiffre (CR1, CR6).
 *
 * L'intervalle se mesure entre deux passages d'un MÊME scénario (`measure_name`) :
 * plusieurs scénarios capturés au même instant donneraient des écarts nuls, et des
 * scénarios décalés un intervalle plus court que le vrai rythme du robot. Pas
 * `measure_id` : la source mippoc y écrit l'identifiant de chaque exécution.
 *
 * Périmètre explicite (app choisie, viewer restreint) : une ligne par app, même sans
 * passage (`dernier = null`) — c'est ce qui permet de dire « aucun passage du robot
 * sur cette app ». Périmètre non restreint : les apps qui ont au moins un passage.
 */
export async function syntheticFreshness(f: FiltersLike): Promise<SyntheticFreshnessRow[]> {
  const sql = await sqlContext(f);
  const robot = sql.where({ dataset: "synthetic", row: "y", time: "y.captured_at" });
  const apps = sql.query.scope.effectiveApps;
  const perimetre = apps === null ? "" : ` right join unnest(${sql.bind(apps)}::text[]) as perimetre(app_id) using (app_id)`;
  return q<SyntheticFreshnessRow>(
    `with executions as (
       select y.app_id, y.captured_at,
              extract(epoch from y.captured_at - lag(y.captured_at) over (
                partition by y.app_id, y.measure_name order by y.captured_at))::float8 as ecart_s
         from syn_snapshot y
        where true${robot}
     ),
     par_app as (
       select app_id, max(captured_at) as dernier,
              percentile_cont(0.5) within group (order by ecart_s) as intervalle_median_s,
              count(*)::int as passages
         from executions
        group by app_id
     )
     select app_id, p.dernier, p.intervalle_median_s, coalesce(p.passages, 0)::int as passages
       from par_app p${perimetre}
      order by app_id`,
    sql.params,
  );
}

export type EtatRobot = "ok" | "warn" | "incident";

export interface CelluleConcordance {
  robot: EtatRobot;
  reel: Rating;
  heures: number;
}

export interface Concordance {
  /** Les 9 cellules (3 états robot × 3 verdicts réels), zéros compris. */
  cellules: CelluleConcordance[];
  /** Heures × couple avec un passage du robot et aucune mesure LCP réelle. */
  robotSeul: number;
  /** Heures × couple avec des mesures LCP réelles et aucun passage du robot. */
  reelSeul: number;
  /** Les deux côtés, mais moins de `effectifMin` mesures LCP : aucun verdict. */
  reelInsuffisant: number;
  /** Les deux côtés et assez de mesures, mais l'état du robot n'est pas renseigné. */
  robotInconnu: number;
  /** Cellule « robot ok × réel au-delà de la borne Bon », par couple, heures décroissantes. */
  anglesMortsParRoute: { serie: string; app_id: string; route: string; heures: number }[];
  /** Bornes du verdict réel, lues dans `THRESHOLDS.LCP` et liées dans la requête. */
  bornesLcp: [number, number];
}

const ETATS_ROBOT: readonly EtatRobot[] = ["ok", "warn", "incident"];
const VERDICTS: readonly Rating[] = ["good", "needs-improvement", "poor"];

/**
 * Concordance des états robot et réel, par heure et par couple (app, route), sur
 * toute la plage (CR4, CR8) : la vérité des COMPTES d'angles morts, là où
 * `blindSpots` n'est qu'une liste plafonnée.
 *
 * Chaque heure × couple compte UNE fois, dans l'ordre : présence de chaque côté
 * (robot seul, réel seul), effectif réel (réel insuffisant), état robot (inconnu),
 * puis cellule de la matrice. Le verdict réel est celui de `rating2026` sur le LCP
 * p75 de l'heure (bon inclusif, mauvais strict), bornes LIÉES depuis
 * `THRESHOLDS.LCP`. Période précédente (`cmp=prev`) : passer une requête dont la
 * plage est `previousRange(query.range)`.
 *
 * Les heures SANS ROUTE (`route` NULL côté réel ou `route_hint` NULL côté robot)
 * sont exclues. `full outer join … using (…, route, …)` ne relie jamais deux NULL
 * (et PostgreSQL refuse `is not distinct from` dans une jointure externe
 * complète) : la même heure comptait à la fois « robot seul » et « réel seul ».
 * Une heure sans route ne désigne de toute façon aucun couple (app, route).
 */
export async function correlationConcordance(f: FiltersLike, effectifMin = EFFECTIF_MIN_HEURE): Promise<Concordance> {
  const sql = await sqlContext(f);
  const sources = correlationSources(sql, "heure");
  const bornesLcp: [number, number] = [THRESHOLDS.LCP[0], THRESHOLDS.LCP[1]];
  const effectif = sql.bind(effectifValide(effectifMin));
  const bon = sql.bind(bornesLcp[0]);
  const mauvais = sql.bind(bornesLcp[1]);
  const rows = await q<{ classe: string; robot: string | null; reel: string | null; app_id: string | null; route: string | null; heures: number }>(
    `with ${sources},
     classees as (
       select app_id, route,
              case
                when s.bucket is null then 'reel_seul'
                when coalesce(r.rum_lcp_n, 0) = 0 then 'robot_seul'
                when r.rum_lcp_n < ${effectif}::int then 'reel_insuffisant'
                when s.syn_state is null then 'robot_inconnu'
                else 'matrice'
              end as classe,
              s.syn_state as robot,
              case
                when r.rum_lcp_p75 <= ${bon}::float8 then 'good'
                when r.rum_lcp_p75 <= ${mauvais}::float8 then 'needs-improvement'
                else 'poor'
              end as reel
         from rum r full outer join syn s using (app_id, route, bucket)
        where route is not null and (s.bucket is not null or r.rum_lcp_n > 0)
     )
     select classe, case when classe = 'matrice' then robot end as robot,
            case when classe = 'matrice' then reel end as reel,
            null::text as app_id, null::text as route, count(*)::int as heures
       from classees
      group by 1, 2, 3
     union all
     select 'angle_mort', null, null, app_id, route, count(*)::int
       from classees
      where classe = 'matrice' and robot = 'ok' and reel <> 'good' and route is not null
      group by app_id, route`,
    sql.params,
  );

  const cellules: CelluleConcordance[] = ETATS_ROBOT.flatMap((robot) => VERDICTS.map((reel) => ({ robot, reel, heures: 0 })));
  const hors = { robot_seul: 0, reel_seul: 0, reel_insuffisant: 0, robot_inconnu: 0 };
  const anglesMortsParRoute: Concordance["anglesMortsParRoute"] = [];
  for (const r of rows) {
    if (r.classe === "angle_mort") {
      anglesMortsParRoute.push({ serie: ecrireSerie(r.app_id!, r.route!), app_id: r.app_id!, route: r.route!, heures: r.heures });
    } else if (r.classe === "matrice") {
      const cellule = cellules.find((c) => c.robot === r.robot && c.reel === r.reel);
      if (cellule) cellule.heures += r.heures;
    } else if (r.classe in hors) {
      hors[r.classe as keyof typeof hors] += r.heures;
    }
  }
  anglesMortsParRoute.sort(
    (a, b) => b.heures - a.heures || (a.route < b.route ? -1 : a.route > b.route ? 1 : a.app_id < b.app_id ? -1 : a.app_id > b.app_id ? 1 : 0),
  );
  return {
    cellules,
    robotSeul: hors.robot_seul,
    reelSeul: hors.reel_seul,
    reelInsuffisant: hors.reel_insuffisant,
    robotInconnu: hors.robot_inconnu,
    anglesMortsParRoute,
    bornesLcp,
  };
}
