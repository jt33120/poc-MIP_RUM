// DSAR — couche I/O (export & effacement). Le périmètre, l'ordre de suppression
// et la RECEVABILITÉ viennent de lib/dsar.ts ; ce module ne fait que les
// exécuter.
//
// L'ANCRE EST `visitor_id`, ET C'EST STRUCTUREL. Aucune requête d'export ni
// d'effacement de ce fichier ne mentionne `user_hash` : il n'existe pas de
// chemin de code pour viser l'ancienne empreinte, même par erreur. Une seule
// requête la lit — `SQL_HERITEES`, qui COMPTE des lignes pour pouvoir expliquer
// un refus, et ne rend jamais leur contenu. Voir l'en-tête de lib/dsar.ts pour
// la raison.
//
// Anti-injection : les noms de tables et la colonne d'ancrage sont des
// constantes de l'allowlist ; seuls app ($1) et l'identifiant ($2) sont
// paramétrés. La sous-requête « sessions du visiteur » est réutilisée telle
// quelle pour tous les enfants.
import {
  buildDsarExport,
  DSAR_ANCHOR,
  DSAR_CHILD_TABLES,
  DSAR_ID_COLUMN,
  DsarRefus,
  dsarVerdict,
  type DsarExport,
  type DsarVerdict,
} from "./dsar";
import { q, tx } from "./db";

/** Périmètre commun : $1 = app ou 'all', $2 = identifiant de visiteur. */
const PERIMETRE = `${DSAR_ID_COLUMN} = $2 and ($1 = 'all' or app_id = $1)`;

/** Sessions du visiteur — la seule porte d'entrée des tables enfant. */
const SESSIONS_SUBQ = `select session_id from rum_session where ${PERIMETRE}`;

/**
 * La SEULE requête de ce module qui touche `user_hash`. Elle compte, et rien
 * d'autre : son résultat sert à dire « je refuse, et voici pourquoi » plutôt que
 * « je n'ai rien », qui serait faux.
 */
const SQL_HERITEES = `select count(*)::int as n from rum_session
                       where user_hash = $2 and ($1 = 'all' or app_id = $1)`;

export interface DsarCount {
  table: string;
  rows: number;
}

/** Recevabilité d'une demande, décomptes à l'appui. */
export interface DsarCible {
  verdict: DsarVerdict;
  /** Sessions portant cet identifiant de visiteur — le périmètre exécutable. */
  sessionsVisiteur: number;
  /** Sessions portant cette valeur en `user_hash` : hors de portée, comptées pour l'expliquer. */
  sessionsHeritees: number;
}

/** Instruit la demande AVANT d'exécuter quoi que ce soit. */
export async function dsarCible(app: string, id: string): Promise<DsarCible> {
  const [v] = await q<{ n: number }>(
    `select count(*)::int as n from rum_session where ${PERIMETRE}`,
    [app, id],
  );
  const [h] = await q<{ n: number }>(SQL_HERITEES, [app, id]);
  const sessionsVisiteur = v?.n ?? 0;
  const sessionsHeritees = h?.n ?? 0;
  return {
    verdict: dsarVerdict({ visiteur: sessionsVisiteur, heritees: sessionsHeritees }),
    sessionsVisiteur,
    sessionsHeritees,
  };
}

/** Lève si la demande n'est pas recevable — appelé par export ET par effacement. */
async function exigerRecevable(app: string, id: string): Promise<void> {
  const cible = await dsarCible(app, id);
  if (cible.verdict !== "execute") throw new DsarRefus(cible.verdict);
}

/** Compte des lignes par table pour ce visiteur (aperçu avant export/effacement). */
export async function dsarCounts(app: string, visitorId: string): Promise<DsarCount[]> {
  const out: DsarCount[] = [];
  for (const t of DSAR_CHILD_TABLES) {
    const [r] = await q<{ n: number }>(
      `select count(*)::int as n from ${t} where session_id in (${SESSIONS_SUBQ})`,
      [app, visitorId],
    );
    out.push({ table: t, rows: r?.n ?? 0 });
  }
  const [s] = await q<{ n: number }>(
    `select count(*)::int as n from rum_session where ${PERIMETRE}`,
    [app, visitorId],
  );
  out.push({ table: DSAR_ANCHOR, rows: s?.n ?? 0 });
  return out;
}

/** Total de lignes couvertes (toutes tables) — 0 = visiteur inconnu sur ce périmètre. */
export function dsarTotalRows(counts: DsarCount[]): number {
  return counts.reduce((acc, c) => acc + c.rows, 0);
}

/**
 * Export complet des données du visiteur (droit d'accès / portabilité).
 * Une clé par table ; l'ancre (rum_session) en dernier pour un document lisible.
 *
 * Lève `DsarRefus` sur une empreinte héritée : mieux vaut répondre partiellement
 * à une demande art. 15 que d'y joindre les données de tiers.
 */
export async function dsarExport(
  app: string,
  visitorId: string,
  generatedAt: string,
): Promise<DsarExport> {
  await exigerRecevable(app, visitorId);
  const tables: Record<string, unknown[]> = {};
  for (const t of DSAR_CHILD_TABLES) {
    tables[t] = await q(
      `select * from ${t} where session_id in (${SESSIONS_SUBQ})`,
      [app, visitorId],
    );
  }
  tables[DSAR_ANCHOR] = await q(
    `select * from rum_session where ${PERIMETRE}`,
    [app, visitorId],
  );
  return buildDsarExport({ app, visitorId, generatedAt, tables });
}

/**
 * Effacement (droit à l'effacement) : supprime toutes les lignes du visiteur
 * dans une TRANSACTION, enfants avant l'ancre (ordre FK-sûr). Renvoie le nombre
 * de lignes supprimées par table. Tout-ou-rien : un échec annule l'ensemble.
 *
 * Lève `DsarRefus` sur une empreinte héritée : effacer sur cette clé
 * supprimerait les données de personnes qui n'ont rien demandé.
 */
export async function dsarErase(
  app: string,
  visitorId: string,
): Promise<{ table: string; deleted: number }[]> {
  await exigerRecevable(app, visitorId);
  return tx(async (client) => {
    const deleted: { table: string; deleted: number }[] = [];
    for (const t of DSAR_CHILD_TABLES) {
      const r = await client.query(
        `delete from ${t} where session_id in (${SESSIONS_SUBQ})`,
        [app, visitorId],
      );
      deleted.push({ table: t, deleted: r.rowCount ?? 0 });
    }
    const r = await client.query(
      `delete from rum_session where ${PERIMETRE}`,
      [app, visitorId],
    );
    deleted.push({ table: DSAR_ANCHOR, deleted: r.rowCount ?? 0 });
    return deleted;
  });
}
