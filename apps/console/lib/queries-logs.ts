// Requêtes de la page « Logs » (supervision du 3e signal OTel -> table rum_log).
// Réutilise le modèle de filtres « v2 » (app 'all', period) — cf. queries-v2.
import { q } from "./db";
import { periodInterval, type Filters } from "./queries-v2";

export interface LogRow {
  id: number;
  app_id: string;
  ts: Date | string;
  severity_num: number | null;
  severity_text: string | null;
  body: string | null;
  source: string | null;
  trace_id: string | null;
  span_id: string | null;
  session_id: string | null;
  route: string | null;
}

export type LevelKey = "all" | "info" | "warn" | "error";

/** Plancher OTLP severityNumber du niveau demandé (null = tous). INFO≥9, WARN≥13, ERROR≥17. */
export function severityFloor(level: string): number | null {
  if (level === "error") return 17;
  if (level === "warn") return 13;
  if (level === "info") return 9;
  return null;
}

export function parseLevel(raw: string | string[] | undefined): LevelKey {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase();
  return v === "info" || v === "warn" || v === "error" ? v : "all";
}

/** Bucket lisible d'un severity_num (pour le badge et l'agrégat). */
export function severityBucket(n: number | null): "error" | "warn" | "info" | "debug" {
  if (n != null && n >= 17) return "error";
  if (n != null && n >= 13) return "warn";
  if (n != null && n >= 9) return "info";
  return "debug";
}

/** Derniers logs de la fenêtre, filtrés par app + niveau plancher. */
export async function logEntries(f: Filters, level: string, limit = 200): Promise<LogRow[]> {
  const floor = severityFloor(level);
  return q<LogRow>(
    `select id, app_id, ts, severity_num, severity_text, body, source,
            trace_id, span_id, session_id, route
       from rum_log
      where ($1 = 'all' or app_id = $1)
        and ts > now() - $2::interval
        and ($3::int is null or severity_num >= $3)
      order by ts desc
      limit $4`,
    [f.app, periodInterval(f), floor, limit],
  );
}

/** Comptes par bucket de sévérité sur la fenêtre (error/warn/info/debug). */
export async function logSeverityCounts(f: Filters): Promise<Record<string, number>> {
  const rows = await q<{ bucket: string; n: number }>(
    `select case when severity_num >= 17 then 'error'
                 when severity_num >= 13 then 'warn'
                 when severity_num >= 9  then 'info'
                 else 'debug' end as bucket,
            count(*)::int as n
       from rum_log
      where ($1 = 'all' or app_id = $1)
        and ts > now() - $2::interval
      group by 1`,
    [f.app, periodInterval(f)],
  );
  const out: Record<string, number> = { error: 0, warn: 0, info: 0, debug: 0 };
  for (const r of rows) out[r.bucket] = r.n;
  return out;
}

/** Anomalie de volume de logs ERROR (z-score horaire vs 7 j) sur les dernières
 *  24 h. Lit la vue v_log_anomaly (migration-v37). Dégrade proprement à [] si la
 *  vue est absente (local/CI) — même pattern fail-soft que health.ts/v_anomaly. */
export interface LogAnomalyRow {
  app_id: string;
  bucket: Date | string;
  errors: number;
  mean_7d: number;
  z_score: number;
}
export async function logAnomalies(f: Filters): Promise<LogAnomalyRow[]> {
  try {
    return await q<LogAnomalyRow>(
      `select app_id, bucket, errors::int as errors, mean_7d::float as mean_7d, z_score::float as z_score
         from v_log_anomaly
        where bucket > now() - interval '24 hours'
          and ($1 = 'all' or app_id = $1)
        order by z_score desc, bucket desc
        limit 20`,
      [f.app],
    );
  } catch {
    return []; // vue absente (env local/CI) -> pas d'anomalies plutôt qu'une erreur
  }
}

/** Routes les plus « bruyantes » (par volume d'erreurs/warnings) sur la fenêtre —
 *  métrique dérivée des logs pour repérer d'où vient le bruit applicatif. */
export interface LogRouteRow {
  route: string;
  errors: number;
  warns: number;
  total: number;
}
export async function logsByRoute(f: Filters): Promise<LogRouteRow[]> {
  return q<LogRouteRow>(
    `select coalesce(nullif(route, ''), '(sans route)') as route,
            count(*) filter (where severity_num >= 17)::int as errors,
            count(*) filter (where severity_num >= 13 and severity_num < 17)::int as warns,
            count(*)::int as total
       from rum_log
      where ($1 = 'all' or app_id = $1)
        and ts > now() - $2::interval
        and route is not null
      group by 1
      having count(*) filter (where severity_num >= 13) > 0  -- au moins un warn/error
      order by errors desc, total desc
      limit 10`,
    [f.app, periodInterval(f)],
  );
}

/** Volume horaire sur 24 h, empilé error/warn/autres -> 3 tableaux de 24 buckets. */
export async function logVolumeByHour(
  f: Filters,
): Promise<{ error: number[]; warn: number[]; other: number[] }> {
  const rows = await q<{ bucket: Date; sev: string; n: number }>(
    `select date_trunc('hour', ts) as bucket,
            case when severity_num >= 17 then 'error'
                 when severity_num >= 13 then 'warn'
                 else 'other' end as sev,
            count(*)::int as n
       from rum_log
      where ($1 = 'all' or app_id = $1)
        and ts > now() - interval '24 hours'
      group by 1, 2`,
    [f.app],
  );
  const mk = () => new Array(24).fill(0) as number[];
  const res = { error: mk(), warn: mk(), other: mk() };
  const now = Date.now();
  for (const r of rows) {
    const idx = 23 - Math.floor((now - new Date(r.bucket).getTime()) / 3_600_000);
    if (idx >= 0 && idx < 24) res[r.sev as "error" | "warn" | "other"][idx] += r.n;
  }
  return res;
}
