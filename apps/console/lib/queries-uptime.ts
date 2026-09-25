// Monitoring synthétique (uptime) — lecture du statut + gestion des checks (admin).
// Les sondes elles-mêmes sont exécutées par l'edge function `uptime` (migration-v42) ;
// ici on lit v_uptime_status et on gère la config uptime_check.
import { q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";

export interface UptimeStatusRow {
  id: number;
  app_id: string;
  name: string;
  url: string;
  method: string;
  expect_status: number;
  enabled: boolean;
  created_at: string;
  last_checked_at: string | null;
  last_ok: boolean | null;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  checks_24h: number;
  up_24h: number;
  uptime_pct_24h: number | null;
}

/** Statut de tous les checks : dernier état + disponibilité 24 h. Actifs d'abord. */
export async function listUptimeStatus(): Promise<UptimeStatusRow[]> {
  return q<UptimeStatusRow>(
    `select id, app_id, name, url, method, expect_status, enabled, created_at,
            last_checked_at, last_ok, last_status_code, last_latency_ms, last_error,
            coalesce(checks_24h, 0)::int as checks_24h,
            coalesce(up_24h, 0)::int as up_24h,
            uptime_pct_24h
     from v_uptime_status
     order by enabled desc, last_ok nulls first, name`,
  );
}

/** Enregistre un check (URL à surveiller). L'edge le sondera au prochain passage. */
export async function createUptimeCheck(
  appId: string,
  name: string,
  url: string,
  expectStatus: number,
  client?: ClientEcriture,
): Promise<string> {
  const { rows } = await ecrire<{ id: string }>(
    client,
    `insert into uptime_check (app_id, name, url, expect_status) values ($1, $2, $3, $4) returning id::text as id`,
    [appId, name, url, expectStatus],
  );
  return rows[0].id;
}

/** Active ou suspend le check `id` de l'application `appId` ; `false` s'il n'y est pas. */
export async function toggleUptimeCheck(id: number, appId: string, enabled: boolean, client?: ClientEcriture): Promise<boolean> {
  const { rowCount } = await ecrire(client, `update uptime_check set enabled = $3 where id = $1 and app_id = $2`, [id, appId, enabled]);
  return rowCount > 0;
}

/** Supprime un check de l'application `appId` et son historique (cascade sur uptime_result). */
export async function deleteUptimeCheck(id: number, appId: string, client?: ClientEcriture): Promise<boolean> {
  const { rowCount } = await ecrire(client, `delete from uptime_check where id = $1 and app_id = $2`, [id, appId]);
  return rowCount > 0;
}
