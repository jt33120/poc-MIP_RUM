// Briefing d'accueil — couche I/O : rassemble les signaux AGRÉGÉS de l'app depuis
// une borne temporelle (fenêtre « depuis la dernière connexion ») + cache
// (table ai_briefing, migration v28) pour ne générer qu'une fois par login.
import { q } from "./db";
import { sloStatus } from "./queries-alerting";
import type { BriefingResult, BriefingSignals } from "./briefing";

/** Rassemble les compteurs fenêtrés (bots exclus sur les sessions) pour l'app. */
export async function gatherBriefingSignals(
  app: string,
  windowStart: Date,
  windowLabel: string,
): Promise<BriefingSignals> {
  const iso = windowStart.toISOString();

  const [counts] = await q<{ sessions: number; pageviews: number; errors: number; new_groups: number }>(
    `select
       (select count(*)::int from rum_session
          where app_id = $1 and last_seen_at > $2 and coalesce(is_bot, false) = false) as sessions,
       (select count(*)::int from rum_pageview
          where app_id = $1 and started_at > $2) as pageviews,
       (select count(*)::int from rum_error
          where app_id = $1 and ts > $2) as errors,
       (select count(*)::int from (
          select fingerprint from rum_error
          where app_id = $1 and fingerprint is not null
          group by fingerprint having min(ts) > $2
        ) g) as new_groups`,
    [app, iso],
  );

  const topErrors = await q<{ type: string; count: number }>(
    `select coalesce(error_type, 'Error') as type, count(*)::int as count
       from rum_error
      where app_id = $1 and ts > $2
      group by 1 order by count desc limit 3`,
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

  return {
    app,
    windowLabel,
    sessions: counts?.sessions ?? 0,
    pageviews: counts?.pageviews ?? 0,
    errors: counts?.errors ?? 0,
    newErrorGroups: counts?.new_groups ?? 0,
    topErrors: topErrors.map((e) => ({ type: e.type, message: "", count: e.count })),
    alerts: alerts?.total ?? 0,
    criticalAlerts: alerts?.critical ?? 0,
    sloBreached,
    healthScore: null,
    worstVital: null,
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
