// Requêtes de lecture du produit Supervision SVI (migration-v51).
//
// Règle non négociable dans ce fichier : TOUTE requête filtre par `app_id` en
// paramètre lié. Les policies RLS de v51 sont une ceinture, pas une bretelle —
// elles restent inertes tant que la console se connecte avec un rôle propriétaire
// (cf. l'en-tête de migration-v47). L'isolation effective des lectures repose donc
// ici, dans ces `where app_id = $n`.
//
// Les intervalles viennent exclusivement de `periodInterval()` : une durée
// réécrite à la main finit par diverger, et deux pages afficheraient des chiffres
// incomparables sous le même libellé.
import { q } from "./db";
import { type Filters, periodInterval } from "./queries-v2";

export type Outcome = "contained" | "transferred" | "abandoned" | "failed";

export interface CallRow {
  call_id: string;
  started_at: string;
  duration_ms: number | null;
  outcome: Outcome | null;
  outcome_detail: string | null;
  entry_point: string | null;
  menu_path_final: string | null;
  queue_name: string | null;
  wait_ms: number | null;
  mos_avg: number | null;
  platform: string;
  is_test: boolean;
  provenance: string[];
  steps: number;
}

/** Liste des appels de la période, la plus récente d'abord. */
export async function sviCalls(f: Filters, limit = 100): Promise<CallRow[]> {
  return q<CallRow>(
    `select c.call_id, c.started_at, c.duration_ms, c.outcome, c.outcome_detail,
            c.entry_point, c.menu_path_final, c.queue_name, c.wait_ms,
            c.mos_avg, c.platform, c.is_test, c.provenance,
            (select count(*) from svi_step s
              where s.app_id = c.app_id and s.call_id = c.call_id)::int as steps
       from svi_call c
      where c.app_id = $1
        and c.started_at > now() - $2::interval
        and c.merged_into is null
      order by c.started_at desc
      limit $3`,
    [f.app, periodInterval(f), limit],
  );
}

export interface SviSummary {
  total: number;
  contained: number;
  transferred: number;
  abandoned: number;
  failed: number;
  open: number;
  /** Appels dont la provenance inclut le niveau « parcours » : sans lui, aucun
   *  entonnoir de menu n'est calculable. Sert à afficher la COUVERTURE plutôt
   *  qu'à extrapoler un taux sur une fraction des appels. */
  with_journey: number;
  avg_duration_ms: number | null;
  avg_wait_ms: number | null;
}

export async function sviSummary(f: Filters): Promise<SviSummary> {
  const rows = await q<SviSummary>(
    `select count(*)::int as total,
            count(*) filter (where outcome = 'contained')::int   as contained,
            count(*) filter (where outcome = 'transferred')::int as transferred,
            count(*) filter (where outcome = 'abandoned')::int   as abandoned,
            count(*) filter (where outcome = 'failed')::int      as failed,
            count(*) filter (where status = 'open')::int         as open,
            count(*) filter (where 'journey' = any(provenance))::int as with_journey,
            round(avg(duration_ms))::int as avg_duration_ms,
            round(avg(wait_ms))::int     as avg_wait_ms
       from svi_call
      where app_id = $1 and started_at > now() - $2::interval and merged_into is null`,
    [f.app, periodInterval(f)],
  );
  return (
    rows[0] ?? {
      total: 0, contained: 0, transferred: 0, abandoned: 0, failed: 0,
      open: 0, with_journey: 0, avg_duration_ms: null, avg_wait_ms: null,
    }
  );
}

export interface StepRow {
  seq: number;
  kind: string;
  node_label: string | null;
  node_id: string | null;
  menu_path: string | null;
  input_class: string | null;
  input_len: number | null;
  input_sensitive: boolean;
  no_match: boolean;
  no_input: boolean;
  started_at: string;
  duration_ms: number | null;
  exit_reason: string | null;
}

/** Un appel et son déroulé. `null` si l'appel n'existe pas dans CETTE app. */
export async function sviCallDetail(
  app: string,
  callId: string,
): Promise<{ call: CallRow; steps: StepRow[] } | null> {
  const call = await q<CallRow>(
    `select c.call_id, c.started_at, c.duration_ms, c.outcome, c.outcome_detail,
            c.entry_point, c.menu_path_final, c.queue_name, c.wait_ms,
            c.mos_avg, c.platform, c.is_test, c.provenance, 0 as steps
       from svi_call c where c.app_id = $1 and c.call_id = $2`,
    [app, callId],
  );
  if (!call[0]) return null;

  const steps = await q<StepRow>(
    `select seq, kind, node_label, node_id, menu_path, input_class, input_len,
            input_sensitive, no_match, no_input, started_at, duration_ms, exit_reason
       from svi_step
      where app_id = $1 and call_id = $2
      order by seq`,
    [app, callId],
  );
  return { call: { ...call[0], steps: steps.length }, steps };
}

/** Répartition horaire des issues, pour l'histogramme empilé. */
export async function sviOutcomesByHour(
  f: Filters,
): Promise<{ bucket: string; outcome: string; n: number }[]> {
  return q(
    `select date_trunc('hour', started_at) as bucket,
            coalesce(outcome, 'open') as outcome, count(*)::int as n
       from svi_call
      where app_id = $1 and started_at > now() - $2::interval and merged_into is null
      group by 1, 2 order by 1`,
    [f.app, periodInterval(f)],
  );
}
