// Couche de données « Performance IA » (feature IA) : SQL pur sur la table
// rum_ai (une ligne par appel LLM). Filtre app/période uniquement — rum_ai n'a
// pas de notion d'appareil, le filtre device est donc ignoré ici.
//
// On réutilise le modèle de filtres « v2 » (app='all' + period) partagé avec
// les pages errors/correlation. L'intervalle SQL est mappé LOCALEMENT (pas de
// dépendance à un symbole non exporté de queries-v2).
import { q } from "./db";
import type { Filters, PeriodKey } from "./queries-v2";

// Intervalle Postgres par période — map locale volontaire (cf. en-tête).
const PERIOD_INTERVAL: Record<PeriodKey, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
};

function intervalOf(f: Filters): string {
  return PERIOD_INTERVAL[f.period] ?? "24 hours";
}

// ---------------------------------------------------------------------------
// Vue d'ensemble (KPI) — agrégat mono-ligne sur la période
// ---------------------------------------------------------------------------

export interface AiOverview {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_p75: number | null;
  error_rate: number; // 0..1 (part d'appels en erreur)
}

/** KPI globaux : nombre d'appels, tokens, coût, latence p75, taux d'erreur. */
export async function aiOverview(f: Filters): Promise<AiOverview> {
  const [r] = await q<{
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
    latency_p75: number | null;
    error_rate: number;
  }>(
    `select
       count(*)::int as calls,
       coalesce(sum(prompt_tokens), 0)::int as prompt_tokens,
       coalesce(sum(completion_tokens), 0)::int as completion_tokens,
       coalesce(sum(total_tokens), 0)::int as total_tokens,
       coalesce(sum(cost_usd), 0)::float8 as cost_usd,
       percentile_cont(0.75) within group (order by latency_ms)::float8 as latency_p75,
       (count(*) filter (where status = 'error')::float8
         / nullif(count(*), 0))::float8 as error_rate
     from rum_ai
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval`,
    [f.app, intervalOf(f)],
  );
  return {
    calls: r?.calls ?? 0,
    prompt_tokens: r?.prompt_tokens ?? 0,
    completion_tokens: r?.completion_tokens ?? 0,
    total_tokens: r?.total_tokens ?? 0,
    cost_usd: r?.cost_usd ?? 0,
    latency_p75: r?.latency_p75 ?? null,
    error_rate: r?.error_rate ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Répartition par modèle
// ---------------------------------------------------------------------------

export interface AiModelRow {
  provider: string | null;
  model: string | null;
  calls: number;
  total_tokens: number;
  cost_usd: number;
  latency_p75: number | null;
  error_rate: number;
}

/** Agrégat par fournisseur/modèle, trié par coût décroissant (top 50). */
export async function aiByModel(f: Filters): Promise<AiModelRow[]> {
  return q<AiModelRow>(
    `select
       provider,
       model,
       count(*)::int as calls,
       coalesce(sum(total_tokens), 0)::int as total_tokens,
       coalesce(sum(cost_usd), 0)::float8 as cost_usd,
       percentile_cont(0.75) within group (order by latency_ms)::float8 as latency_p75,
       (count(*) filter (where status = 'error')::float8
         / nullif(count(*), 0))::float8 as error_rate
     from rum_ai
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
     group by provider, model
     order by coalesce(sum(cost_usd), 0) desc
     limit 50`,
    [f.app, intervalOf(f)],
  );
}

// ---------------------------------------------------------------------------
// Répartition par route
// ---------------------------------------------------------------------------

export interface AiRouteRow {
  route: string | null;
  calls: number;
  total_tokens: number;
  cost_usd: number;
  latency_p75: number | null;
  error_rate: number;
}

/** Agrégat par route, trié par nombre d'appels décroissant (top 50). */
export async function aiByRoute(f: Filters): Promise<AiRouteRow[]> {
  return q<AiRouteRow>(
    `select
       route,
       count(*)::int as calls,
       coalesce(sum(total_tokens), 0)::int as total_tokens,
       coalesce(sum(cost_usd), 0)::float8 as cost_usd,
       percentile_cont(0.75) within group (order by latency_ms)::float8 as latency_p75,
       (count(*) filter (where status = 'error')::float8
         / nullif(count(*), 0))::float8 as error_rate
     from rum_ai
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
     group by route
     order by count(*) desc
     limit 50`,
    [f.app, intervalOf(f)],
  );
}

// ---------------------------------------------------------------------------
// Gouvernance — agrégat par route + part reliée à une session RUM
// ---------------------------------------------------------------------------

export interface AiGovRow {
  route: string | null;
  calls: number;
  cost_usd: number;
  latency_p75: number | null;
  error_rate: number;
  with_session: number; // appels reliés à une session RUM
}

/** Agrégat par route pour la vue Gouvernance : coût/latence/erreurs + nombre
 * d'appels corrélés à une session (pour lire la traçabilité au parcours). */
export async function aiGovernance(f: Filters): Promise<AiGovRow[]> {
  return q<AiGovRow>(
    `select
       route,
       count(*)::int as calls,
       coalesce(sum(cost_usd), 0)::float8 as cost_usd,
       percentile_cont(0.75) within group (order by latency_ms)::float8 as latency_p75,
       (count(*) filter (where status = 'error')::float8
         / nullif(count(*), 0))::float8 as error_rate,
       count(*) filter (where session_id is not null)::int as with_session
     from rum_ai
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
     group by route
     order by count(*) desc
     limit 50`,
    [f.app, intervalOf(f)],
  );
}

// ---------------------------------------------------------------------------
// Coût par jour (série pour la barre horizontale)
// ---------------------------------------------------------------------------

export interface AiDailyRow {
  day: string;
  calls: number;
  cost_usd: number;
  total_tokens: number;
}

/** Coût/tokens/appels agrégés par jour sur la période (max 30 lignes). */
export async function aiDaily(f: Filters): Promise<AiDailyRow[]> {
  return q<AiDailyRow>(
    `select
       date_trunc('day', ts) as day,
       count(*)::int as calls,
       coalesce(sum(cost_usd), 0)::float8 as cost_usd,
       coalesce(sum(total_tokens), 0)::int as total_tokens
     from rum_ai
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
     group by date_trunc('day', ts)
     order by day
     limit 30`,
    [f.app, intervalOf(f)],
  );
}

// ---------------------------------------------------------------------------
// Derniers appels IA (flux brut)
// ---------------------------------------------------------------------------

export interface AiCallRow {
  id: number;
  ts: string;
  provider: string | null;
  model: string | null;
  route: string | null;
  total_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  status: string;
  error_type: string | null;
  session_id: string | null;
}

/** Les N derniers appels LLM (ordre antéchronologique). */
export async function recentAiCalls(f: Filters, limit = 50): Promise<AiCallRow[]> {
  return q<AiCallRow>(
    `select
       id::int as id,
       ts,
       provider,
       model,
       route,
       total_tokens::int as total_tokens,
       cost_usd::float8 as cost_usd,
       latency_ms::float8 as latency_ms,
       status,
       error_type,
       session_id
     from rum_ai
     where ($1 = 'all' or app_id = $1)
       and ts > now() - $2::interval
     order by ts desc
     limit $3`,
    [f.app, intervalOf(f), limit],
  );
}

// ---------------------------------------------------------------------------
// Coût par utilisateur (UTI-B) — join rum_ai.session_id -> rum_session.user_hash
// ---------------------------------------------------------------------------

export interface AiUserCostRow {
  user_hash: string;
  calls: number;
  cost_usd: number;
  total_tokens: number;
  error_rate: number;
  last_ts: string;
}

/** Coût IA agrégé par utilisateur (user_hash anonymisé), trié par coût décroissant. */
export async function aiCostByUser(f: Filters, limit = 100): Promise<AiUserCostRow[]> {
  return q<AiUserCostRow>(
    `select
       s.user_hash,
       count(*)::int as calls,
       coalesce(sum(a.cost_usd), 0)::float8 as cost_usd,
       coalesce(sum(a.total_tokens), 0)::int as total_tokens,
       (count(*) filter (where a.status = 'error')::float8
         / nullif(count(*), 0))::float8 as error_rate,
       max(a.ts) as last_ts
     from rum_ai a
     join rum_session s on s.session_id = a.session_id
     where ($1 = 'all' or a.app_id = $1)
       and a.ts > now() - $2::interval
       and s.user_hash is not null
     group by s.user_hash
     order by coalesce(sum(a.cost_usd), 0) desc
     limit $3`,
    [f.app, intervalOf(f), limit],
  );
}

// ---------------------------------------------------------------------------
// Qualité IA ↔ satisfaction (chantier B) — relie le coût/la fiabilité de l'IA
// au ressenti RÉEL des utilisateurs. Le chaînon que ne fait pas un observability
// classique : « nos appels LLM dégradent-ils (ou non) la satisfaction ? ».
// ---------------------------------------------------------------------------

// Seuil CSAT « positif » (note ≥ 4/5) — aligné sur lib/experience.ts.
const CSAT_POSITIVE = 4;

export interface AiSatisfactionRow {
  used_ai: boolean;
  /** Sessions AVEC feedback dans ce segment (n de la comparaison). */
  sessions: number;
  avg_score: number | null;
  positives: number;
}

/** CSAT des sessions qui ont déclenché ≥ 1 appel IA vs celles sans IA, sur la
 *  période. Jointure au grain SESSION (rum_ai.session_id ↔ rum_event feedback) :
 *  une session peut avoir plusieurs appels IA mais on la compte une fois. Zéro
 *  PII (agrégat de scores anonymes). Renvoie 0..2 lignes (segments présents). */
export async function aiSatisfaction(f: Filters): Promise<AiSatisfactionRow[]> {
  return q<AiSatisfactionRow>(
    `with fb as (
       select session_id, avg((nullif(props->>'score',''))::numeric) as score
         from rum_event
        where ($1 = 'all' or app_id = $1) and name = 'feedback'
          and ts > now() - $2::interval and session_id is not null
          and nullif(props->>'score','') is not null
        group by session_id
     ), ai_s as (
       select distinct session_id from rum_ai
        where ($1 = 'all' or app_id = $1) and ts > now() - $2::interval and session_id is not null
     )
     select (a.session_id is not null) as used_ai,
            count(*)::int as sessions,
            round(avg(fb.score), 2)::float8 as avg_score,
            count(*) filter (where fb.score >= ${CSAT_POSITIVE})::int as positives
       from fb left join ai_s a using (session_id)
      group by 1`,
    [f.app, intervalOf(f)],
  );
}

export interface AiErrorRow {
  error_type: string;
  calls: number;
}

/** Répartition des appels IA en échec par type d'erreur (fiabilité : QUOI casse
 *  — timeout, refus/guardrail, quota…). status='error' posé à l'ingestion. */
export async function aiErrorBreakdown(f: Filters): Promise<AiErrorRow[]> {
  return q<AiErrorRow>(
    `select coalesce(nullif(error_type, ''), 'inconnu') as error_type,
            count(*)::int as calls
       from rum_ai
      where ($1 = 'all' or app_id = $1)
        and ts > now() - $2::interval
        and status = 'error'
      group by 1
      order by calls desc
      limit 10`,
    [f.app, intervalOf(f)],
  );
}

export interface AiUnattributedCost {
  calls: number;
  cost_usd: number;
}

/** Coût IA non rattachable (appel sans session, ou session sans user_hash). */
export async function aiCostUnattributed(f: Filters): Promise<AiUnattributedCost> {
  const [r] = await q<AiUnattributedCost>(
    `select
       count(*)::int as calls,
       coalesce(sum(a.cost_usd), 0)::float8 as cost_usd
     from rum_ai a
     left join rum_session s on s.session_id = a.session_id
     where ($1 = 'all' or a.app_id = $1)
       and a.ts > now() - $2::interval
       and (a.session_id is null or s.user_hash is null)`,
    [f.app, intervalOf(f)],
  );
  return { calls: r?.calls ?? 0, cost_usd: r?.cost_usd ?? 0 };
}
