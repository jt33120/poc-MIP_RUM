// Requêtes SQL P1 (alerting mature) : SLO + error-budget + canaux de notification.
// Helpers purs (sloView, severityRank…) dans ./alerting ; accès base via ./db.
//
// LISTES DE CONFIGURATION (P6.2). SLO et canaux ne sont bornés que par le périmètre
// d'apps de la requête commune : chaque SLO se mesure sur sa propre fenêtre, sa
// métrique et sa route, et l'écran n'annonce ni plage ni filtre de population.
import { q } from "./db";
import { queryOf, type FiltersLike } from "./filters";
import { binder, compileScope } from "./query-compiler";

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

/** Statut + error-budget des SLO actifs du périmètre (une app nommée est passée à slo_status). */
export async function sloStatus(f: FiltersLike): Promise<SloStatusRow[]> {
  const query = queryOf(f);
  const { params, bind } = binder();
  const apps = query.scope.effectiveApps;
  const cible = bind(apps?.length === 1 ? apps[0] : null);
  return q<SloStatusRow>(
    `select st.slo_id::int as slo_id, st.app_id, st.name, st.metric, st.route, st.objective, st.window_days,
            st.attainment, st.budget, st.burned_pct, st.fast_burn
     from slo_status(${cible}::text) st
     where true${compileScope(query, "st.app_id", bind)}`,
    params,
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

/** Tous les SLO (actifs ET désactivés) du périmètre — gestion : permet de réactiver un
 *  SLO qui sort de slo_status() une fois désactivé. */
export async function listSlo(f: FiltersLike): Promise<SloRaw[]> {
  const { params, bind } = binder();
  return q<SloRaw>(
    `select s.id::int as id, s.app_id, s.name, s.metric, s.objective, s.window_days, s.route, s.active
     from slo s
     where true${compileScope(queryOf(f), "s.app_id", bind)}
     order by s.id desc`,
    params,
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

/** Canaux : globaux (app_id null) + ceux des apps du périmètre. */
export async function listChannels(f: FiltersLike): Promise<NotifyChannelRow[]> {
  const { params, bind } = binder();
  return q<NotifyChannelRow>(
    `select c.id::int as id, c.app_id, c.kind, c.target, c.severity_min, c.active
     from notify_channel c
     where c.app_id is null or (true${compileScope(queryOf(f), "c.app_id", bind)})
     order by c.id desc`,
    params,
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
