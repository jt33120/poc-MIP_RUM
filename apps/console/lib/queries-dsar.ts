// DSAR — couche I/O (export & effacement par user_hash). Le périmètre et l'ordre
// de suppression viennent de lib/dsar.ts (allowlist de tables, ordre FK-sûr).
//
// Anti-injection : les noms de tables sont des constantes de l'allowlist ; seuls
// app ($1) et user_hash ($2) sont paramétrés. La sous-requête « sessions de
// l'utilisateur » est réutilisée telle quelle pour tous les enfants.
import {
  buildDsarExport,
  DSAR_ANCHOR,
  DSAR_CHILD_TABLES,
  type DsarExport,
} from "./dsar";
import { q, tx } from "./db";

// Sessions de l'utilisateur ($1 = app ou 'all', $2 = user_hash).
const SESSIONS_SUBQ = `select session_id from rum_session where user_hash = $2 and ($1 = 'all' or app_id = $1)`;

export interface DsarCount {
  table: string;
  rows: number;
}

/** Compte des lignes par table pour cet utilisateur (aperçu avant export/effacement). */
export async function dsarCounts(app: string, userHash: string): Promise<DsarCount[]> {
  const out: DsarCount[] = [];
  for (const t of DSAR_CHILD_TABLES) {
    const [r] = await q<{ n: number }>(
      `select count(*)::int as n from ${t} where session_id in (${SESSIONS_SUBQ})`,
      [app, userHash],
    );
    out.push({ table: t, rows: r?.n ?? 0 });
  }
  const [s] = await q<{ n: number }>(
    `select count(*)::int as n from rum_session where user_hash = $2 and ($1 = 'all' or app_id = $1)`,
    [app, userHash],
  );
  out.push({ table: DSAR_ANCHOR, rows: s?.n ?? 0 });
  return out;
}

/** Total de lignes couvertes (toutes tables) — 0 = utilisateur inconnu sur ce périmètre. */
export function dsarTotalRows(counts: DsarCount[]): number {
  return counts.reduce((acc, c) => acc + c.rows, 0);
}

/**
 * Export complet des données de l'utilisateur (droit d'accès / portabilité).
 * Une clé par table ; l'ancre (rum_session) en dernier pour un document lisible.
 */
export async function dsarExport(
  app: string,
  userHash: string,
  generatedAt: string,
): Promise<DsarExport> {
  const tables: Record<string, unknown[]> = {};
  for (const t of DSAR_CHILD_TABLES) {
    tables[t] = await q(
      `select * from ${t} where session_id in (${SESSIONS_SUBQ})`,
      [app, userHash],
    );
  }
  tables[DSAR_ANCHOR] = await q(
    `select * from rum_session where user_hash = $2 and ($1 = 'all' or app_id = $1)`,
    [app, userHash],
  );
  return buildDsarExport({ app, userHash, generatedAt, tables });
}

/**
 * Effacement (droit à l'effacement) : supprime toutes les lignes de l'utilisateur
 * dans une TRANSACTION, enfants avant l'ancre (ordre FK-sûr). Renvoie le nombre
 * de lignes supprimées par table. Tout-ou-rien : un échec annule l'ensemble.
 */
export async function dsarErase(
  app: string,
  userHash: string,
): Promise<{ table: string; deleted: number }[]> {
  return tx(async (client) => {
    const deleted: { table: string; deleted: number }[] = [];
    for (const t of DSAR_CHILD_TABLES) {
      const r = await client.query(
        `delete from ${t} where session_id in (${SESSIONS_SUBQ})`,
        [app, userHash],
      );
      deleted.push({ table: t, deleted: r.rowCount ?? 0 });
    }
    const r = await client.query(
      `delete from rum_session where user_hash = $2 and ($1 = 'all' or app_id = $1)`,
      [app, userHash],
    );
    deleted.push({ table: DSAR_ANCHOR, deleted: r.rowCount ?? 0 });
    return deleted;
  });
}
