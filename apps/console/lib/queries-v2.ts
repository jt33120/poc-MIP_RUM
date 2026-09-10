// Requêtes SQL v0.3 (chantier A4) : groupes d'erreurs, alerting, corrélation v2.
// Lit les filtres globaux (app/period/device) de façon défensive — défauts app='all', period=24h.
import { q } from "./db";
// Le DÉCOUPAGE EN SEAUX seulement — pas le modèle de filtres, dont la dette est
// décrite juste en dessous. Les deux tables PERIODS de ce dépôt partagent leurs
// clés et leurs intervalles ; tests/unit/erreurs-fenetre.test.ts vérifie qu'elles
// ne divergent pas, plutôt que d'introduire ici une troisième copie du seau.
import { nombreDeSeaux, seauEnSecondes } from "./filters";

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

/** Largeur d'un seau pour cette période, en secondes (dérivée de lib/filters). */
export function periodSeauSecondes(f: Filters): number {
  return seauEnSecondes(f.period);
}
/** Nombre de seaux couvrant la période — 1 h → 12, 24 h → 24, 7 j → 28. */
export function periodNombreDeSeaux(f: Filters): number {
  return nombreDeSeaux(f.period);
}
/** Libellé d'un seau, pour les titres de graphiques (« 5 min », « 1 h », « 6 h »). */
export function periodSeauLabel(f: Filters): string {
  const s = seauEnSecondes(f.period);
  return s < 3600 ? `${s / 60} min` : `${s / 3600} h`;
}

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

// ════════════ Les compteurs d'un groupe d'erreurs, BORNÉS PAR LA FENÊTRE ═══════
//
// CE QUI ÉTAIT FAUX (finding 1.1 de docs/AUDIT_RUM_EXTERNE.md). Ce SELECT lisait
// `v_error_group_ext`, une vue SANS AUCUNE BORNE TEMPORELLE. La tuile de l'écran
// annonçait « Occurrences · 1 h » et affichait le total depuis la première
// ingestion. Un exploitant qui basculait 7 j → 24 h → 1 h voyait LE MÊME NOMBRE
// et en concluait que rien ne se calmait. Le tri, sur ce même total cumulé,
// plaçait un bug corrigé il y a deux semaines devant la régression du jour.
//
// ─────────── POURQUOI PAS L'AGRÉGAT HORAIRE QUE PROPOSAIT L'AUDIT ─────────────
//
// Le plan recommandait une table `error_group_hourly (app_id, fingerprint, hour,
// occurrences, sessions, visitors)`, « sommable sur n'importe quelle fenêtre ».
// Elle ne l'est pas. `occurrences` est un comptage de lignes, donc sommable ;
// `sessions` et `visitors` sont des comptages de DISTINCTS, et une session à
// cheval sur deux heures apparaît dans les deux seaux. Mesuré sur une base
// réelle — une personne, une session, un bug rencontré trois fois en trois
// heures :
//
//     somme des seaux horaires : 3 occurrences, 3 sessions, 3 visiteurs
//     vérité sur la fenêtre    : 3 occurrences, 1 session,  1 visiteur
//
// On aurait remplacé un sur-comptage DANS LE TEMPS par un sur-comptage DES
// DISTINCTS — et précisément sur la mesure dont l'audit veut faire le critère de
// tri (« impact réel »). Trier sur un impact gonflé serait pire que trier sur le
// volume. On retient donc l'autre option du même rapport : une source paramétrée
// par la fenêtre, exacte pour les trois compteurs.
//
// ────────────────────────── CE QUE ÇA COÛTE, MESURÉ ──────────────────────────
//
// Sur 500 000 erreurs / 2 000 signatures / 40 000 sessions réparties sur 30
// jours — bien au-delà du volume réel —, médiane de cinq exécutions :
//
//     1 h             52 ms
//     24 h (défaut)   99 ms
//     7 j (maximum)  194 ms
//
// `PERIODS` (lib/filters.ts) n'expose QUE ces trois fenêtres : il n'existe pas
// de cas plus large à optimiser. AUCUN INDEX N'A ÉTÉ AJOUTÉ — un candidat
// `(app_id, fingerprint, ts)` a été construit et mesuré, le planificateur ne
// l'a jamais choisi (0 scan) et les temps étaient identiques à 5 ms près. Un
// index inutile se paie à chaque écriture sur la table la plus chaude du
// système.
//
// LE VRAI PIÈGE EST LA MATÉRIALISATION DES CTE. Tant que `origine` référençait
// `fenetre`, PostgreSQL matérialisait cette dernière — et une CTE matérialisée
// perd le parallélisme : 24 h passait de 99 ms à 287 ms. Les deux CTE sont donc
// délibérément INDÉPENDANTES, jointes seulement à la fin. C'est la raison pour
// laquelle `origine` refait son propre filtre plutôt que de se restreindre aux
// groupes déjà retenus, ce qui paraîtrait pourtant plus économe.

/**
 * Source des groupes d'erreurs, paramétrée par la fenêtre.
 *
 * `pApp` et `pFenetre` sont les POSITIONS des paramètres ($1, $2…) chez
 * l'appelant — jamais des valeurs. Deux appelants (liste et détail) numérotent
 * différemment, et c'est la seule raison de cette indirection.
 *
 * `first_seen` reste NON BORNÉ, délibérément : « première apparition » n'a de
 * sens que depuis toujours. C'est la seule colonne dans ce cas, et l'écran la
 * libelle comme telle. Elle est calculée sur les seuls groupes retenus par la
 * fenêtre, pas sur toute la table.
 */
function sourceGroupes(pApp: number, pFenetre: number): string {
  const perimetre = `($${pApp} = 'all' or e.app_id = $${pApp})`;
  return `
  with fenetre as (
    select e.app_id, e.fingerprint,
           -- SOMME, pas comptage (v59). Le SDK déduplique une erreur qui se
           -- répète et joint le nombre d'occurrences qu'il a tues : compter les
           -- lignes sous-estimerait précisément la boucle qu'on veut voir.
           sum(e.occurrences)           as occurrences,
           count(distinct e.session_id) as sessions,
           count(distinct s.visitor_id) as users_affected,
           max(e.ts)                    as last_seen,
           max(e.error_type)            as error_type,
           max(e.message)               as sample_message
      from rum_error e
      left join rum_session s on s.session_id = e.session_id
     where e.fingerprint is not null
       and e.ts > now() - $${pFenetre}::interval
       and ${perimetre}
     group by e.app_id, e.fingerprint
  ),
  origine as (
    select e.app_id, e.fingerprint, min(e.ts) as first_seen
      from rum_error e
     where e.fingerprint is not null
       and ${perimetre}
     group by e.app_id, e.fingerprint
  ),
  g as (
    select fenetre.*, origine.first_seen
      from fenetre join origine using (app_id, fingerprint)
  )`;
}

/** Le SELECT commun (liste + détail), au-dessus de `sourceGroupes`. */
const ERROR_GROUP_SELECT = `
  select g.app_id, g.fingerprint, g.error_type, g.sample_message,
         g.occurrences::int as occurrences, g.sessions::int as sessions,
         g.users_affected::int as users_affected, g.first_seen, g.last_seen,
         coalesce(st.status, 'open') as status,
         st.resolved_at,
         (st.status = 'resolved' and g.last_seen > st.resolved_at) as regressed
  from g
  left join error_status st on st.app_id = g.app_id and st.fingerprint = g.fingerprint`;

// Tri triage : régressions d'abord, puis ouvertes, puis résolues, puis ignorées.
//
// PUIS PAR IMPACT SUR LA FENÊTRE, pas par volume cumulé. « Impact » = visiteurs
// distincts touchés : mille occurrences chez une personne pèsent moins qu'une
// occurrence chez cent.
//
// LA RETOMBÉE SUR `sessions` N'EST PAS UN ORNEMENT. Depuis migration-v57 seules
// les sessions portant un `visitor_id` alimentent `users_affected` ; tant que la
// rétention n'a pas fait disparaître l'historique (30 jours), beaucoup de
// groupes auront 0 visiteur identifié. Sans ce deuxième critère, le tri
// s'effondrerait sur le départage et rangerait au hasard. `sessions` est exact
// sur la fenêtre et constitue le meilleur substitut d'impact disponible.
const ERROR_GROUP_ORDER = `
  order by (case
    when (st.status = 'resolved' and g.last_seen > st.resolved_at) then 0
    when coalesce(st.status, 'open') = 'open' then 1
    when coalesce(st.status, 'open') = 'ignored' then 3
    else 2 end),
    g.users_affected desc, g.sessions desc, g.occurrences desc, g.last_seen desc`;

export async function errorGroups(
  f: Filters,
  page?: { limit?: number; offset?: number },
): Promise<ErrorGroupRow[]> {
  const limit = page?.limit ?? 100;
  const offset = page?.offset ?? 0;
  // La fenêtre n'est plus un simple filtre de sélection : elle définit les
  // compteurs eux-mêmes. Un groupe absent de la fenêtre ne sort pas du `group by`,
  // donc le `where g.last_seen > …` d'avant est devenu redondant.
  return q<ErrorGroupRow>(
    `${sourceGroupes(1, 2)}
     ${ERROR_GROUP_SELECT}
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

/**
 * Occurrences par seau, par fingerprint → un tableau par groupe pour les
 * sparklines et l'histogramme empilé.
 *
 * SUIT LA PÉRIODE CHOISIE, et c'est le correctif. La version précédente était
 * figée sur 24 seaux d'une heure : sur une fenêtre de 7 jours, l'écran classait
 * les groupes sur 7 jours puis dessinait leurs 24 dernières heures, sous un
 * titre annonçant l'un ou l'autre selon l'endroit. Un groupe pouvait être en
 * tête du tableau avec une sparkline entièrement plate.
 *
 * Le seau vient de PERIODS (1 h → 5 min, 24 h → 1 h, 7 j → 6 h) et le nombre de
 * seaux en est DÉRIVÉ, de sorte qu'ajuster une période ne laisse pas les
 * graphiques en arrière.
 */
export async function errorSparklines(
  fingerprints: string[],
  f: Filters,
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (!fingerprints.length) return map;
  const secondes = periodSeauSecondes(f);
  const nb = periodNombreDeSeaux(f);
  // Seaux par époque plutôt que date_trunc : celui-ci ne sait pas tronquer à
  // 5 minutes ni à 6 heures, et la largeur du seau est justement variable ici.
  const rows = await q<{ fingerprint: string; seau: string; n: number }>(
    `select fingerprint,
            floor(extract(epoch from ts) / $3)::bigint as seau,
            count(*)::int as n
     from rum_error
     where fingerprint = any($1)
       and ts > now() - $4::interval
       and ($2 = 'all' or app_id = $2)
     group by 1, 2`,
    [fingerprints, f.app, secondes, periodInterval(f)],
  );
  const seauCourant = Math.floor(Date.now() / 1000 / secondes);
  for (const fp of fingerprints) map.set(fp, new Array(nb).fill(0));
  for (const r of rows) {
    // index 0 = le seau le plus ancien de la fenêtre, index nb-1 = le courant.
    const idx = nb - 1 - (seauCourant - Number(r.seau));
    if (idx >= 0 && idx < nb) map.get(r.fingerprint)![idx] += r.n;
  }
  return map;
}

/** Erreurs v0.1 sans fingerprint (non groupables) — affiché en note de bas de page. */
export async function unfingerprintedCount(f: Filters): Promise<number> {
  const [r] = await q<{ n: number }>(
    `select coalesce(sum(occurrences), 0)::int as n
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
  // Le détail lit la MÊME source que la liste, avec la MÊME fenêtre : sans cela,
  // ouvrir une ligne afficherait des chiffres différents de celle qu'on a cliquée.
  const [group] = await q<ErrorGroupRow>(
    `${sourceGroupes(2, 3)}
     ${ERROR_GROUP_SELECT}
     where g.fingerprint = $1
     limit 1`,
    [fingerprint, f.app, periodInterval(f)],
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
