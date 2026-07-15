// Requêtes « déploiements & régression » (Voie A · inc. 3). Un marqueur de
// déploiement croisé aux métriques RUM répond à « et l'heure de régression » :
// on compare le p75 LCP et le volume d'erreurs sur la fenêtre AVANT vs APRÈS le
// dernier déploiement. Convention : $1 = app (null = toutes).
import { q } from "./db";
import type { Filters } from "./filters";

export interface DeployRow {
  id: number;
  ts: Date;
  version: string | null;
  env: string;
  source: string;
}

/** Marqueurs de déploiement récents pour l'app filtrée. */
export async function listDeploys(f: Filters, limit = 20): Promise<DeployRow[]> {
  return q<DeployRow>(
    `select id, ts, version, env, source
       from deploy_marker
      where ($1::text is null or app_id = $1)
      order by ts desc
      limit ${Number(limit)}`,
    [f.app],
  );
}

/** Enregistre un déploiement (appelé par l'endpoint CI/CD). */
export async function recordDeploy(
  appId: string,
  version: string | null,
  env: string,
  source: string,
  ts?: Date,
): Promise<void> {
  await q(
    `insert into deploy_marker (app_id, version, env, source, ts)
     values ($1, $2, $3, $4, coalesce($5, now()))`,
    [appId, version, env, source, ts ?? null],
  );
}

export interface DeployImpact {
  deploy_ts: Date | null;
  version: string | null;
  env: string | null;
  lcp_before: number | null;
  lcp_after: number | null;
  errors_before: number;
  errors_after: number;
}

/**
 * Impact du DERNIER déploiement : p75 LCP et nombre d'erreurs JS sur les 2 h qui
 * précèdent vs les 2 h qui suivent. null partout si aucun déploiement.
 */
export async function latestDeployImpact(f: Filters): Promise<DeployImpact | null> {
  const [row] = await q<DeployImpact>(
    `with d as (
       select ts, version, env from deploy_marker
       where ($1::text is null or app_id = $1)
       order by ts desc limit 1
     )
     select
       (select ts from d)      as deploy_ts,
       (select version from d) as version,
       (select env from d)     as env,
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m, d
         where m.name = 'LCP' and ($1::text is null or m.app_id = $1)
           and m.ts >= d.ts - interval '2 hours' and m.ts < d.ts) as lcp_before,
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m, d
         where m.name = 'LCP' and ($1::text is null or m.app_id = $1)
           and m.ts >= d.ts and m.ts < d.ts + interval '2 hours') as lcp_after,
       coalesce((select count(*) from rum_error e, d
          where ($1::text is null or e.app_id = $1)
            and e.ts >= d.ts - interval '2 hours' and e.ts < d.ts), 0)::int as errors_before,
       coalesce((select count(*) from rum_error e, d
          where ($1::text is null or e.app_id = $1)
            and e.ts >= d.ts and e.ts < d.ts + interval '2 hours'), 0)::int as errors_after`,
    [f.app],
  );
  return row?.deploy_ts ? row : null;
}

export interface RegressionVerdict {
  regressed: boolean;
  deltaPct: number | null;
}

/**
 * Verdict de régression pour une mesure « plus haut = pire » (LCP, taux d'erreur).
 * Régression si l'après dépasse l'avant d'au moins `ratio` (défaut +20 %). Pur.
 */
export function assessRegression(
  before: number | null,
  after: number | null,
  ratio = 1.2,
): RegressionVerdict {
  if (before == null || after == null || before <= 0) return { regressed: false, deltaPct: null };
  const deltaPct = Math.round(((after - before) / before) * 100);
  return { regressed: after >= before * ratio, deltaPct };
}
