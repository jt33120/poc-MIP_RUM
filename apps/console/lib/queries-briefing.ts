// Briefing d'accueil — couche I/O : rassemble les signaux AGRÉGÉS de l'app depuis
// une borne temporelle (fenêtre « depuis la dernière connexion ») + cache
// (table ai_briefing, migration v28) pour ne générer qu'une fois par login.
import { q } from "./db";
import { sloStatus } from "./queries-alerting";
import { assessReliability, type BriefingResult, type BriefingSignals } from "./briefing";
import { healthScore } from "./health";
import { vitalsP75, type VitalAgg } from "./queries";
import type { Filters } from "./filters";
import { rating2026 } from "./rating";

/** Filtre « instantané 24 h » pour l'app (ou null = portail, hors apps internes). */
function snapshotFilters(app: string | null): Filters {
  return { app, period: "24h", device: null, segment: [] };
}

/** Pire vital (rating le plus mauvais) d'un jeu de p75, ou null. */
function worstVitalOf(vitals: VitalAgg[]): { name: string; p75: number } | null {
  const sev = (v: VitalAgg) => {
    const r = rating2026(v.name, v.p75);
    return r === "poor" ? 2 : r === "needs-improvement" ? 1 : 0;
  };
  let worst: VitalAgg | null = null;
  let ws = 0;
  for (const v of vitals) {
    const s = sev(v);
    if (s > ws) {
      ws = s;
      worst = v;
    }
  }
  return worst ? { name: worst.name, p75: Math.round(worst.p75) } : null;
}

/** Instantané de santé actuel (24 h) : score composite + pire vital. Fail-soft. */
async function perfSnapshot(app: string | null): Promise<{ healthScore: number | null; worstVital: { name: string; p75: number } | null }> {
  const f = snapshotFilters(app);
  try {
    const [h, vitals] = await Promise.all([healthScore(f), vitalsP75(f)]);
    return { healthScore: h.score, worstVital: worstVitalOf(vitals) };
  } catch {
    return { healthScore: null, worstVital: null };
  }
}

/** Rassemble les compteurs fenêtrés (bots exclus sur les sessions) pour l'app. */
export async function gatherBriefingSignals(
  app: string,
  windowStart: Date,
  windowLabel: string,
): Promise<BriefingSignals> {
  const iso = windowStart.toISOString();

  const [counts] = await q<{ sessions: number; pageviews: number; errors: number; new_groups: number; measures: number }>(
    `select
       (select count(*)::int from rum_session
          where app_id = $1 and last_seen_at > $2 and coalesce(is_bot, false) = false) as sessions,
       (select count(*)::int from rum_pageview
          where app_id = $1 and started_at > $2) as pageviews,
       (select count(*)::int from rum_error
          where app_id = $1 and ts > $2) as errors,
       (select count(*)::int from rum_metric
          where app_id = $1 and ts > $2) as measures,
       (select count(*)::int from (
          select fingerprint from rum_error
          where app_id = $1 and fingerprint is not null
          group by fingerprint having min(ts) > $2
        ) g) as new_groups`,
    [app, iso],
  );

  // Groupé par fingerprint (comme /errors), pas juste par type : permet un lien
  // direct vers /errors/[fingerprint] au lieu d'un renvoi générique vers /errors.
  const topErrors = await q<{ type: string; fingerprint: string | null; count: number }>(
    `select coalesce(error_type, 'Error') as type, fingerprint, count(*)::int as count
       from rum_error
      where app_id = $1 and ts > $2 and fingerprint is not null
      group by fingerprint, error_type
      order by count desc limit 3`,
    [app, iso],
  );

  // Routes les plus lentes (LCP p75) sur la fenêtre — pour le checklist « pages
  // à checker » quand la santé est dégradée. having : évite le bruit d'une route
  // avec 1-2 mesures.
  const topSlowRoutes = await q<{ route: string; lcp_p75: number }>(
    `select m.route, percentile_cont(0.75) within group (order by m.value) as lcp_p75
       from rum_metric m join rum_session s using (session_id)
      where m.app_id = $1 and m.name = 'LCP' and m.ts > $2
        and not coalesce(s.is_bot, false) and m.route is not null
      group by m.route
      having count(*) >= 5
      order by lcp_p75 desc
      limit 3`,
    [app, iso],
  );

  // alert_event n'a pas d'app_id : il se scope via la règle (alert_rule) ou le SLO.
  const [alerts] = await q<{ total: number; critical: number }>(
    `select count(*)::int as total,
            count(*) filter (where ae.severity in ('critical', 'page', 'error'))::int as critical
       from alert_event ae
       left join alert_rule r on r.id = ae.rule_id
       left join slo s on s.id = ae.slo_id
      where coalesce(r.app_id, s.app_id) = $1 and ae.fired_at > $2`,
    [app, iso],
  );

  const slo = await sloStatus(app);
  const sloBreached = slo.filter((s) => s.burned_pct != null && s.burned_pct >= 100).length;

  const sessions = counts?.sessions ?? 0;
  const measures = counts?.measures ?? 0;
  const snap = await perfSnapshot(app);

  return {
    app,
    windowLabel,
    sessions,
    pageviews: counts?.pageviews ?? 0,
    errors: counts?.errors ?? 0,
    newErrorGroups: counts?.new_groups ?? 0,
    topErrors: topErrors.map((e) => ({ type: e.type, message: "", count: e.count, fingerprint: e.fingerprint })),
    alerts: alerts?.total ?? 0,
    criticalAlerts: alerts?.critical ?? 0,
    sloBreached,
    healthScore: snap.healthScore,
    worstVital: snap.worstVital,
    topSlowRoutes: topSlowRoutes.map((r) => ({ route: r.route, lcp_p75: Number(r.lcp_p75) })),
    measures,
    reliable: assessReliability(sessions, measures),
  };
}

/** Sentinelle d'app pour le cache du briefing PORTAIL (toutes apps, hors internes). */
export const PORTAL_APP = "__portal__";

/** Signaux agrégés sur TOUTES les apps (hors internes) — briefing « portail »
 *  affiché en vue « Tous ». Même structure que le briefing par app. */
export async function gatherPortalSignals(windowStart: Date, windowLabel: string): Promise<BriefingSignals> {
  const iso = windowStart.toISOString();
  const notInternal = "not in (select app_id from app_registry where internal)";

  const [counts] = await q<{ sessions: number; pageviews: number; errors: number; new_groups: number; measures: number }>(
    `select
       (select count(*)::int from rum_session
          where app_id ${notInternal} and last_seen_at > $1 and coalesce(is_bot, false) = false) as sessions,
       (select count(*)::int from rum_pageview
          where app_id ${notInternal} and started_at > $1) as pageviews,
       (select count(*)::int from rum_error
          where app_id ${notInternal} and ts > $1) as errors,
       (select count(*)::int from rum_metric
          where app_id ${notInternal} and ts > $1) as measures,
       (select count(*)::int from (
          select fingerprint from rum_error
          where app_id ${notInternal} and fingerprint is not null
          group by fingerprint having min(ts) > $1
        ) g) as new_groups`,
    [iso],
  );

  // groupé par (fingerprint, app_id) : le portail agrège plusieurs apps, donc
  // le lien /errors/[fingerprint] doit être scopé à l'app propriétaire du groupe.
  const topErrors = await q<{ type: string; fingerprint: string | null; app_id: string; count: number }>(
    `select coalesce(error_type, 'Error') as type, fingerprint, app_id, count(*)::int as count
       from rum_error
      where app_id ${notInternal} and ts > $1 and fingerprint is not null
      group by fingerprint, error_type, app_id
      order by count desc limit 3`,
    [iso],
  );

  // alertes toutes apps (hors internes), scopées via règle ou SLO.
  const [alerts] = await q<{ total: number; critical: number }>(
    `select count(*)::int as total,
            count(*) filter (where ae.severity in ('critical', 'page', 'error'))::int as critical
       from alert_event ae
       left join alert_rule r on r.id = ae.rule_id
       left join slo s on s.id = ae.slo_id
      where ae.fired_at > $1
        and coalesce(r.app_id, s.app_id) ${notInternal}`,
    [iso],
  );

  const sessions = counts?.sessions ?? 0;
  const measures = counts?.measures ?? 0;
  const snap = await perfSnapshot(null);

  return {
    app: "l'ensemble du portail (toutes les applications)",
    windowLabel,
    sessions,
    pageviews: counts?.pageviews ?? 0,
    errors: counts?.errors ?? 0,
    newErrorGroups: counts?.new_groups ?? 0,
    topErrors: topErrors.map((e) => ({ type: e.type, message: "", count: e.count, fingerprint: e.fingerprint, appId: e.app_id })),
    alerts: alerts?.total ?? 0,
    criticalAlerts: alerts?.critical ?? 0,
    sloBreached: 0, // les SLO sont par app ; le portail se concentre sur santé/erreurs/alertes agrégées
    healthScore: snap.healthScore,
    worstVital: snap.worstVital,
    measures,
    reliable: assessReliability(sessions, measures),
  };
}

export interface CachedBriefing {
  window_start: string;
  status: string;
  payload: BriefingResult;
  generated_at: string;
}

/** Entrée de cache pour (app, utilisateur), ou null. */
export async function getCachedBriefing(app: string, email: string): Promise<CachedBriefing | null> {
  const [row] = await q<CachedBriefing>(
    `select window_start, status, payload, generated_at
       from ai_briefing where app_id = $1 and user_email = $2`,
    [app, email],
  );
  return row ?? null;
}

/** Écrit/écrase le briefing en cache pour (app, utilisateur) et sa fenêtre. */
export async function putCachedBriefing(
  app: string,
  email: string,
  windowStart: Date,
  result: BriefingResult,
): Promise<void> {
  await q(
    `insert into ai_briefing (app_id, user_email, window_start, status, payload, generated_at)
       values ($1, $2, $3, $4, $5, now())
     on conflict (app_id, user_email)
       do update set window_start = excluded.window_start, status = excluded.status,
                     payload = excluded.payload, generated_at = now()`,
    [app, email, windowStart.toISOString(), result.status, JSON.stringify(result)],
  );
}
