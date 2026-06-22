// Requêtes SQL P1 (alerting mature) : SLO + error-budget + canaux de notification.
// Helpers purs (sloView, severityRank…) dans ./alerting ; accès base via ./db.
import { q } from "./db";

// ---------------------------------------------------------------------------
// SLO (objectifs de service) — vue calculée par la fonction slo_status()
// ---------------------------------------------------------------------------

export interface SloStatusRow {
  slo_id: number;
  app_id: string;
  name: string;
  metric: string;
  route: string | null;
  objective: number; // 0..1
  window_days: number;
  attainment: number; // 0..1
  budget: number; // 1 - objective
  burned_pct: number | null; // % du budget consommé (null si budget nul)
  fast_burn: boolean;
}

/** Statut + error-budget des SLO actifs (slo_status gère NULL = toutes apps). */
export async function sloStatus(app: string | null): Promise<SloStatusRow[]> {
  return q<SloStatusRow>(
    `select slo_id::int as slo_id, app_id, name, metric, route, objective, window_days,
            attainment, budget, burned_pct, fast_burn
     from slo_status($1)`,
    [app && app !== "all" ? app : null],
  );
}

export interface SloRaw {
  id: number;
  app_id: string;
  name: string;
  metric: string;
  objective: number;
  window_days: number;
  route: string | null;
  active: boolean;
}

/** Tous les SLO (actifs ET désactivés) — gestion : permet de réactiver un SLO
 *  qui sort de slo_status() une fois désactivé. */
export async function listSlo(app: string | null): Promise<SloRaw[]> {
  return q<SloRaw>(
    `select id::int as id, app_id, name, metric, objective, window_days, route, active
     from slo
     where $1::text is null or app_id = $1
     order by id desc`,
    [app && app !== "all" ? app : null],
  );
}

export interface SloInput {
  app_id: string;
  name: string;
  metric: string;
  objective: number; // 0..1
  window_days: number;
  route: string | null;
}

export async function insertSlo(s: SloInput): Promise<void> {
  await q(
    `insert into slo (app_id, name, metric, objective, window_days, route)
     values ($1, $2, $3, $4, $5, $6)`,
    [s.app_id, s.name, s.metric, s.objective, s.window_days, s.route],
  );
}

/** Bascule activation/désactivation (flip en SQL : pas d'état à transporter). */
export async function toggleSlo(id: number): Promise<void> {
  await q(`update slo set active = not active where id = $1`, [id]);
}

export async function deleteSlo(id: number): Promise<void> {
  await q(`delete from slo where id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Canaux de notification (routing par sévérité)
// ---------------------------------------------------------------------------

export interface NotifyChannelRow {
  id: number;
  app_id: string | null; // null = global (tous les tenants)
  kind: string;
  target: string;
  severity_min: string;
  active: boolean;
}

/** Canaux : globaux (app_id null) + ceux de l'app filtrée ; tous si pas de filtre. */
export async function listChannels(app: string | null): Promise<NotifyChannelRow[]> {
  return q<NotifyChannelRow>(
    `select id::int as id, app_id, kind, target, severity_min, active
     from notify_channel
     where $1 is null or app_id is null or app_id = $1
     order by id desc`,
    [app && app !== "all" ? app : null],
  );
}

export interface ChannelInput {
  app_id: string | null;
  kind: string;
  target: string;
  severity_min: string;
}

export async function insertChannel(c: ChannelInput): Promise<void> {
  await q(
    `insert into notify_channel (app_id, kind, target, severity_min)
     values ($1, $2, $3, $4)`,
    [c.app_id, c.kind, c.target, c.severity_min],
  );
}

export async function toggleChannel(id: number): Promise<void> {
  await q(`update notify_channel set active = not active where id = $1`, [id]);
}

export async function deleteChannel(id: number): Promise<void> {
  await q(`delete from notify_channel where id = $1`, [id]);
}
