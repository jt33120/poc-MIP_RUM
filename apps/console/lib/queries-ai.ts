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
