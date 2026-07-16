// Résumé RUM propriétaire (livrable UTI) — agrégats TECHNIQUES uniquement (aucune
// PII : ni IP, ni contenu DOM, ni email). Scopé app + fenêtre, trafic bot exclu.
// Produit exactement le contrat /api/rum/summary. Tous les numériques sont castés
// (::int) pour revenir en nombres (pas de string bigint/numeric), null si absent.
import { q } from "./db";
import type { SummaryWindow } from "./read-tokens";

export interface SummarySeriesPoint {
  date: string;
  sessions: number;
  page_views: number;
  errors: number;
  avg_load_ms: number | null;
}
export interface SummaryRoute {
  route: string;
  views: number;
  avg_ms: number | null;
  errors: number;
}
export interface SummaryError {
  message: string;
  count: number;
  last_seen: string;
}
export interface SummaryAiModel {
  provider: string | null;
  model: string | null;
  calls: number;
  tokens: number;
  cost_usd: number;
}
export interface SummaryAiUser {
  user_hash: string;
  calls: number;
  cost_usd: number;
}
/** Ventilation IA par fonction (rum_ai.operation) × route. `operation` renvoyé
 *  BRUT (valeurs métier du client, ex. extraction/scoring/draft/…) — jamais
 *  renommé. Permet à UTI d'afficher la PERF par fonction à côté du coût. */
export interface SummaryAiOperation {
  operation: string | null;
  route: string | null;
  calls: number;
  cost_usd: number;
  tokens: number;
  p75_latency_ms: number | null;
  ttft_p75_ms: number | null;
  error_rate: number | null;
  /** true si le coût 24 h de cette fonction dévie fortement (z > 3) de sa
   *  baseline journalière (vue v_ai_op_anomaly). Détection auto, sans seuil. */
  anomaly: boolean;
  /** z-score du coût (null si pas en anomalie). */
  anomaly_score: number | null;
  // --- Qualité par fonction : « cette fonction coûte cher ET déçoit » ---------
  /** Part d'appels refusés par le modèle (status='error' + error_type de type
   *  refus/guardrail/safety/moderation). 0..1 ; null si 0 appel. */
  refusal_rate: number | null;
  /** Part de régénérations : events rum_event name='ai_regenerate'
   *  {operation, route} / appels de la fonction. 0..1 ; 0 tant qu'UTI n'émet
   *  pas l'event (voir contrat plus bas). */
  regen_rate: number | null;
  /** Part de 👎 : events name='ai_feedback' {operation, route, thumb} —
   *  down / (up+down). 0..1 ; null si aucun pouce sur la fonction. */
  thumbs_down_rate: number | null;
  /** CSAT des sessions ayant utilisé cette fonction (part de notes ≥ 4/5 des
   *  feedbacks liés). 0..1 ; null si aucun feedback lié. Grain session. */
  csat: number | null;
}
/** Point de série journalière IA (pour superposer latence/erreurs au volume). */
export interface SummaryAiSeriesPoint {
  date: string; // YYYY-MM-DD
  calls: number;
  cost_usd: number;
  p75_latency_ms: number | null;
  error_rate: number | null;
}
export interface RumSummary {
  app: string;
  window: SummaryWindow;
  generated_at: string;
  sessions: number;
  users: number;
  page_views: number;
  avg_load_ms: number | null;
  p75_lcp_ms: number | null;
  p75_inp_ms: number | null;
  error_rate: number | null;
  frustration_signals: number;
  series: SummarySeriesPoint[];
  top_routes: SummaryRoute[];
  top_errors: SummaryError[];
  ai_calls: number;
  ai_tokens: number;
  ai_cost_usd: number;
  ai_p75_latency_ms: number | null;
  ai_error_rate: number | null;
  ai_by_model: SummaryAiModel[];
  ai_top_users: SummaryAiUser[];
  /** Ventilation IA par fonction × route (perf à côté du coût). Additif. */
  ai_by_operation: SummaryAiOperation[];
  /** Série journalière IA (calls/coût/latence p75/taux d'erreur). Additif. */
  ai_series: SummaryAiSeriesPoint[];
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** Construit le résumé pour un app + une fenêtre (intervalle Postgres). */
export async function rumSummary(
  app: string,
  windowKey: SummaryWindow,
  interval: string,
  generatedAt: string,
): Promise<RumSummary> {
  const p = [app, interval];

  const [
    kpis, series, routes, errors, aiKpis, aiByModel, aiTopUsers,
    aiByOperation, aiSeries, aiOpAnomalies, aiRegenThumbs, aiCsatByOp,
  ] = await Promise.all([
    q<{
      sessions: number;
      users: number;
      page_views: number;
      avg_load_ms: number | null;
      p75_lcp_ms: number | null;
      p75_inp_ms: number | null;
      frustration_signals: number;
      error_sessions: number;
    }>(
      `select
         (select count(distinct p.session_id)::int from rum_pageview p join rum_session s on s.session_id=p.session_id
            where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false)) as sessions,
         (select count(distinct s.user_hash)::int from rum_session s
            where s.app_id=$1 and s.started_at>now()-$2::interval and not coalesce(s.is_bot,false) and s.user_hash is not null) as users,
         (select count(*)::int from rum_pageview p join rum_session s on s.session_id=p.session_id
            where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false)) as page_views,
         (select round(avg(m.value))::int from rum_metric m join rum_session s on s.session_id=m.session_id
            where m.app_id=$1 and m.name='FCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as avg_load_ms,
         (select percentile_cont(0.75) within group (order by m.value)::int from rum_metric m join rum_session s on s.session_id=m.session_id
            where m.app_id=$1 and m.name='LCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as p75_lcp_ms,
         (select percentile_cont(0.75) within group (order by m.value)::int from rum_metric m join rum_session s on s.session_id=m.session_id
            where m.app_id=$1 and m.name='INP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as p75_inp_ms,
         (select count(*)::int from rum_event e join rum_session s on s.session_id=e.session_id
            where e.app_id=$1 and e.name in ('frustration.rage','frustration.dead') and e.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as frustration_signals,
         (select count(distinct e.session_id)::int from rum_error e join rum_session s on s.session_id=e.session_id
            where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false)) as error_sessions`,
      p,
    ),
    q<SummarySeriesPoint>(
      `select to_char(d::date,'YYYY-MM-DD') as date,
              coalesce(pv.sessions,0)::int as sessions,
              coalesce(pv.page_views,0)::int as page_views,
              coalesce(er.errors,0)::int as errors,
              fcp.avg_load_ms
       from generate_series((now()-$2::interval)::date, now()::date, interval '1 day') d
       left join (
         select date_trunc('day',p.started_at)::date dd, count(distinct p.session_id) sessions, count(*) page_views
         from rum_pageview p join rum_session s on s.session_id=p.session_id
         where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false) group by 1
       ) pv on pv.dd=d::date
       left join (
         select date_trunc('day',e.ts)::date dd, count(*) errors
         from rum_error e join rum_session s on s.session_id=e.session_id
         where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false) group by 1
       ) er on er.dd=d::date
       left join (
         select date_trunc('day',m.ts)::date dd, round(avg(m.value))::int avg_load_ms
         from rum_metric m join rum_session s on s.session_id=m.session_id
         where m.app_id=$1 and m.name='FCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false) group by 1
       ) fcp on fcp.dd=d::date
       order by d`,
      p,
    ),
    q<SummaryRoute>(
      `with pv as (
         select p.route, count(*)::int views from rum_pageview p join rum_session s on s.session_id=p.session_id
         where p.app_id=$1 and p.started_at>now()-$2::interval and not coalesce(s.is_bot,false) and p.route is not null group by p.route
       ), er as (
         select e.route, count(*)::int errors from rum_error e join rum_session s on s.session_id=e.session_id
         where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false) and e.route is not null group by e.route
       ), fcp as (
         select m.route, round(avg(m.value))::int avg_ms from rum_metric m join rum_session s on s.session_id=m.session_id
         where m.app_id=$1 and m.name='FCP' and m.ts>now()-$2::interval and not coalesce(s.is_bot,false) and m.route is not null group by m.route
       )
       select pv.route, pv.views, fcp.avg_ms, coalesce(er.errors,0)::int errors
       from pv left join er using(route) left join fcp using(route)
       order by pv.views desc limit 10`,
      p,
    ),
    q<{ message: string; count: number; last_seen: string }>(
      `select left(e.message,200) as message, count(*)::int as count, max(e.ts) as last_seen
       from rum_error e join rum_session s on s.session_id=e.session_id
       where e.app_id=$1 and e.ts>now()-$2::interval and not coalesce(s.is_bot,false)
         and e.message is not null and e.message <> ''
       group by left(e.message,200)
       order by count(*) desc limit 10`,
      p,
    ),
    q<{ calls: number; tokens: number; cost_usd: number; latency_p75: number | null; error_rate: number | null }>(
      `select
         count(*)::int as calls,
         coalesce(sum(total_tokens), 0)::int as tokens,
         coalesce(sum(cost_usd), 0)::float8 as cost_usd,
         percentile_cont(0.75) within group (order by latency_ms)::float8 as latency_p75,
         (count(*) filter (where status = 'error')::float8 / nullif(count(*), 0))::float8 as error_rate
       from rum_ai
       where app_id = $1 and ts > now() - $2::interval`,
      p,
    ),
    q<SummaryAiModel>(
      `select provider, model, count(*)::int as calls, coalesce(sum(total_tokens), 0)::int as tokens,
              coalesce(sum(cost_usd), 0)::float8 as cost_usd
       from rum_ai
       where app_id = $1 and ts > now() - $2::interval
       group by provider, model
       order by coalesce(sum(cost_usd), 0) desc limit 10`,
      p,
    ),
    q<SummaryAiUser>(
      `select s.user_hash, count(*)::int as calls, coalesce(sum(a.cost_usd), 0)::float8 as cost_usd
       from rum_ai a join rum_session s on s.session_id = a.session_id
       where a.app_id = $1 and a.ts > now() - $2::interval and s.user_hash is not null
       group by s.user_hash
       order by coalesce(sum(a.cost_usd), 0) desc limit 10`,
      p,
    ),
    // Ventilation par fonction (operation) × route : perf par fonction (ce que la
    // facturation OpenRouter n'a pas). operation gardé BRUT (valeurs métier client).
    q<{
      operation: string | null;
      route: string | null;
      calls: number;
      cost_usd: number;
      tokens: number;
      p75_latency_ms: number | null;
      ttft_p75_ms: number | null;
      error_rate: number | null;
      refusal_rate: number | null;
    }>(
      `select
         operation, route,
         count(*)::int as calls,
         coalesce(sum(cost_usd), 0)::float8 as cost_usd,
         coalesce(sum(total_tokens), 0)::int as tokens,
         percentile_cont(0.75) within group (order by latency_ms)::float8 as p75_latency_ms,
         percentile_cont(0.75) within group (order by ttft_ms) filter (where ttft_ms is not null)::float8 as ttft_p75_ms,
         (count(*) filter (where status = 'error')::float8 / nullif(count(*), 0))::float8 as error_rate,
         -- refus modèle : erreurs de type refus/guardrail/safety/moderation
         (count(*) filter (where status = 'error'
            and coalesce(error_type,'') ~* 'refus|content.?filter|guardrail|safety|moderation')::float8
          / nullif(count(*), 0))::float8 as refusal_rate
       from rum_ai
       where app_id = $1 and ts > now() - $2::interval
       group by operation, route
       order by coalesce(sum(cost_usd), 0) desc
       limit 100`,
      p,
    ),
    // Série journalière IA : un point par jour de la fenêtre (jours creux à 0 /
    // latence null) pour superposer latence/erreurs au volume côté UTI.
    q<{
      date: string;
      calls: number;
      cost_usd: number;
      p75_latency_ms: number | null;
      error_rate: number | null;
    }>(
      `select to_char(d::date,'YYYY-MM-DD') as date,
              coalesce(a.calls,0)::int as calls,
              coalesce(a.cost_usd,0)::float8 as cost_usd,
              a.p75_latency_ms,
              a.error_rate
       from generate_series((now()-$2::interval)::date, now()::date, interval '1 day') d
       left join (
         select date_trunc('day', ts)::date dd,
                count(*)::int calls,
                coalesce(sum(cost_usd),0)::float8 cost_usd,
                percentile_cont(0.75) within group (order by latency_ms)::float8 p75_latency_ms,
                (count(*) filter (where status='error')::float8 / nullif(count(*),0))::float8 error_rate
         from rum_ai
         where app_id=$1 and ts>now()-$2::interval
         group by 1
       ) a on a.dd = d::date
       order by d`,
      p,
    ),
    // Anomalies de coût par fonction (z-score 24 h vs baseline) — self-catching :
    // la vue v_ai_op_anomaly peut être absente en CI/local, on dégrade à [] sans
    // casser le reste du résumé (même esprit que logAnomalies).
    (async (): Promise<{ operation: string | null; route: string | null; z_score: number | null }[]> => {
      try {
        return await q(
          `select operation, route, z_score::float8 as z_score
             from v_ai_op_anomaly where app_id = $1`,
          [app],
        );
      } catch {
        return [];
      }
    })(),
    // Régénérations & pouces par fonction : events custom émis par le client
    // (rum_event name='ai_regenerate' / 'ai_feedback', props {operation, route, thumb}).
    // Vide tant qu'UTI ne les émet pas -> regen_rate 0 / thumbs_down_rate null.
    q<{ operation: string | null; route: string | null; regen: number; thumb_up: number; thumb_down: number }>(
      `select props->>'operation' as operation, props->>'route' as route,
              count(*) filter (where name='ai_regenerate')::int as regen,
              count(*) filter (where name='ai_feedback' and props->>'thumb'='up')::int as thumb_up,
              count(*) filter (where name='ai_feedback' and props->>'thumb'='down')::int as thumb_down
         from rum_event
        where app_id=$1 and ts>now()-$2::interval and name in ('ai_regenerate','ai_feedback')
        group by 1, 2`,
      p,
    ),
    // CSAT par fonction (grain session) : sessions ayant utilisé la fonction ⋈
    // feedback de la session. Zéro PII (scores anonymes agrégés).
    q<{ operation: string | null; route: string | null; with_fb: number; positives: number }>(
      `with fn_sessions as (
         select distinct operation, route, session_id from rum_ai
          where app_id=$1 and ts>now()-$2::interval and session_id is not null
       ), fb as (
         select session_id, avg((nullif(props->>'score',''))::numeric) as score
           from rum_event
          where app_id=$1 and name='feedback' and ts>now()-$2::interval
            and session_id is not null and nullif(props->>'score','') is not null
          group by session_id
       )
       select f.operation, f.route,
              count(fb.session_id)::int as with_fb,
              count(*) filter (where fb.score >= 4)::int as positives
         from fn_sessions f join fb using (session_id)
        group by f.operation, f.route`,
      p,
    ),
  ]);

  // Index des anomalies par clé fonction (operation|route, null -> "") pour fusion.
  const anomalyByOp = new Map<string, number | null>(
    aiOpAnomalies.map((r) => [`${r.operation ?? ""}|${r.route ?? ""}`, r.z_score]),
  );
  // Régénérations / pouces par fonction.
  const rtByOp = new Map<string, { regen: number; up: number; down: number }>(
    aiRegenThumbs.map((r) => [`${r.operation ?? ""}|${r.route ?? ""}`, { regen: r.regen, up: r.thumb_up, down: r.thumb_down }]),
  );
  // CSAT par fonction.
  const csatByOp = new Map<string, { with_fb: number; positives: number }>(
    aiCsatByOp.map((r) => [`${r.operation ?? ""}|${r.route ?? ""}`, { with_fb: r.with_fb, positives: r.positives }]),
  );

  const k = kpis[0];
  const sessions = k?.sessions ?? 0;
  const errorRate = sessions > 0 ? (k?.error_sessions ?? 0) / sessions : null;

  return {
    app,
    window: windowKey,
    generated_at: generatedAt,
    sessions,
    users: k?.users ?? 0,
    page_views: k?.page_views ?? 0,
    avg_load_ms: n(k?.avg_load_ms),
    p75_lcp_ms: n(k?.p75_lcp_ms),
    p75_inp_ms: n(k?.p75_inp_ms),
    error_rate: errorRate == null ? null : Math.round(errorRate * 10000) / 10000,
    frustration_signals: k?.frustration_signals ?? 0,
    series: series.map((s) => ({ ...s, avg_load_ms: n(s.avg_load_ms) })),
    top_routes: routes.map((r) => ({ ...r, avg_ms: n(r.avg_ms) })),
    top_errors: errors.map((e) => ({ message: e.message, count: e.count, last_seen: iso(e.last_seen) })),
    ai_calls: aiKpis[0]?.calls ?? 0,
    ai_tokens: aiKpis[0]?.tokens ?? 0,
    ai_cost_usd: aiKpis[0]?.cost_usd ?? 0,
    ai_p75_latency_ms: n(aiKpis[0]?.latency_p75),
    ai_error_rate: aiKpis[0]?.error_rate == null ? null : Math.round(aiKpis[0].error_rate * 10000) / 10000,
    ai_by_model: aiByModel,
    ai_top_users: aiTopUsers,
    ai_by_operation: aiByOperation.map((o) => {
      const key = `${o.operation ?? ""}|${o.route ?? ""}`;
      const z = anomalyByOp.has(key) ? anomalyByOp.get(key)! : null;
      const rt = rtByOp.get(key);
      const cs = csatByOp.get(key);
      const round4 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10000) / 10000);
      // regen_rate : régénérations / appels (0 tant qu'UTI n'émet pas l'event).
      const regenRate = o.calls > 0 ? (rt?.regen ?? 0) / o.calls : null;
      // thumbs_down_rate : down / (up+down) ; null si aucun pouce.
      const thumbs = (rt?.up ?? 0) + (rt?.down ?? 0);
      const thumbsDownRate = thumbs > 0 ? (rt?.down ?? 0) / thumbs : null;
      // csat : positives / feedbacks liés ; null si aucun feedback lié.
      const csat = cs && cs.with_fb > 0 ? cs.positives / cs.with_fb : null;
      return {
        operation: o.operation,
        route: o.route,
        calls: o.calls,
        cost_usd: o.cost_usd,
        tokens: o.tokens,
        p75_latency_ms: n(o.p75_latency_ms),
        ttft_p75_ms: n(o.ttft_p75_ms),
        error_rate: round4(o.error_rate),
        anomaly: anomalyByOp.has(key),
        anomaly_score: n(z),
        refusal_rate: round4(o.refusal_rate),
        regen_rate: round4(regenRate),
        thumbs_down_rate: round4(thumbsDownRate),
        csat: round4(csat),
      };
    }),
    ai_series: aiSeries.map((s) => ({
      date: s.date,
      calls: s.calls,
      cost_usd: s.cost_usd,
      p75_latency_ms: n(s.p75_latency_ms),
      error_rate: s.error_rate == null ? null : Math.round(s.error_rate * 10000) / 10000,
    })),
  };
}
