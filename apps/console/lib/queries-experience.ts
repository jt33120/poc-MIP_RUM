// Couche de données « Expérience utilisateur » (feedback + score). Les feedbacks
// arrivent par le canal d'événements custom : rum_event(name='feedback',
// props={score:1..5, comment}). Aucune table ni ingestion spécifique. Le score
// d'expérience est calculé en composant ces feedbacks avec la perf perçue (LCP)
// et la frustration (rum_event 'frustration.*') — cf. lib/experience.ts.
import { q } from "./db";
import { type Filters, periodInterval } from "./queries-v2";

const APP = (f: Filters) => (f.app === "all" ? "all" : f.app);

export interface FeedbackStats {
  count: number;
  positives: number; // score >= 4
  avg: number | null;
  promoters: number; // 5
  passives: number; // 3–4
  detractors: number; // 1–2
}

/** Agrégats des feedbacks sur la période (score dans props->>'score'). */
export async function feedbackStats(f: Filters): Promise<FeedbackStats> {
  const [r] = await q<FeedbackStats>(
    `with fb as (
       select (nullif(props->>'score',''))::int as score
       from rum_event
       where name = 'feedback'
         and ($1 = 'all' or app_id = $1)
         and ts > now() - $2::interval
     )
     select
       count(*) filter (where score is not null)::int as count,
       count(*) filter (where score >= 4)::int as positives,
       avg(score)::float8 as avg,
       count(*) filter (where score >= 5)::int as promoters,
       count(*) filter (where score between 3 and 4)::int as passives,
       count(*) filter (where score between 1 and 2)::int as detractors
     from fb`,
    [APP(f), periodInterval(f)],
  );
  return (
    r ?? { count: 0, positives: 0, avg: null, promoters: 0, passives: 0, detractors: 0 }
  );
}

export interface ExperienceContext {
  lcp_p75: number | null;
  sessions: number;
  frustration: number; // rage + dead clicks
}

/** Contexte perf/frustration pour composer le score d'expérience. */
export async function experienceContext(f: Filters): Promise<ExperienceContext> {
  const [r] = await q<ExperienceContext>(
    `select
       (select percentile_cont(0.75) within group (order by value)
          from rum_metric
          where name = 'LCP' and ($1 = 'all' or app_id = $1) and ts > now() - $2::interval
       )::float8 as lcp_p75,
       (select count(*)::int from rum_session
          where ($1 = 'all' or app_id = $1) and started_at > now() - $2::interval
       ) as sessions,
       (select count(*)::int from rum_event
          where name in ('frustration.rage','frustration.dead')
            and ($1 = 'all' or app_id = $1) and ts > now() - $2::interval
       ) as frustration`,
    [APP(f), periodInterval(f)],
  );
  return r ?? { lcp_p75: null, sessions: 0, frustration: 0 };
}

export interface FeedbackTrendRow {
  bucket: string;
  count: number;
  positives: number;
}

/** Tendance du CSAT dans le temps (buckets journaliers, max 30 points). */
export async function feedbackTrend(f: Filters): Promise<FeedbackTrendRow[]> {
  return q<FeedbackTrendRow>(
    `select date_trunc('day', ts) as bucket,
            count(*) filter (where (nullif(props->>'score',''))::int is not null)::int as count,
            count(*) filter (where (nullif(props->>'score',''))::int >= 4)::int as positives
     from rum_event
     where name = 'feedback' and ($1 = 'all' or app_id = $1) and ts > now() - $2::interval
     group by 1 order by 1 limit 30`,
    [APP(f), periodInterval(f)],
  );
}

export interface FeedbackRow {
  id: number;
  ts: string;
  score: number | null;
  comment: string | null;
  route: string | null;
  session_id: string | null;
}

/** Derniers verbatims (commentaire déjà scrubbé PII à l'ingestion). */
export async function recentFeedback(f: Filters, limit = 30): Promise<FeedbackRow[]> {
  return q<FeedbackRow>(
    `select id::int as id, ts,
            (nullif(props->>'score',''))::int as score,
            nullif(props->>'comment','') as comment,
            route, session_id
     from rum_event
     where name = 'feedback' and ($1 = 'all' or app_id = $1) and ts > now() - $2::interval
     order by ts desc limit $3`,
    [APP(f), periodInterval(f), limit],
  );
}

export interface RouteCsatRow {
  route: string | null;
  count: number;
  positives: number;
  avg: number | null;
}

/** CSAT par route — pour relier satisfaction et parcours (top 20 par volume). */
export async function feedbackByRoute(f: Filters): Promise<RouteCsatRow[]> {
  return q<RouteCsatRow>(
    `select route,
            count(*)::int as count,
            count(*) filter (where (nullif(props->>'score',''))::int >= 4)::int as positives,
            avg((nullif(props->>'score',''))::int)::float8 as avg
     from rum_event
     where name = 'feedback' and ($1 = 'all' or app_id = $1) and ts > now() - $2::interval
     group by route order by count(*) desc limit 20`,
    [APP(f), periodInterval(f)],
  );
}
