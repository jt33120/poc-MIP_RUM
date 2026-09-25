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
  buildDsarIdentityExport,
  DSAR_ANCHOR,
  DSAR_CHILD_TABLES,
  DSAR_ID_COLUMN,
  DsarRefus,
  dsarVerdict,
  type DsarExport,
  type DsarVerdict,
  type DsarIdentityKind,
  type EtatBarriere,
} from "./dsar";
import type { PoolClient } from "pg";
import { VERROU_INGESTION_NS } from "@mip/backend/lib/privacy-barriere.mjs";
import { q, tx } from "./db";

// ═══════════════ P8.1 — l'effacement est SÉRIALISÉ avec l'ingestion ══════════
//
// LA FAILLE D'ORIGINE. Ce module identifiait les sessions EXISTANTES puis
// supprimait leurs lignes. Tout ce qui arrivait après ce relevé — un lot déjà
// déposé en file, un beacon en vol, un chunk de rejeu, un log OTel portant la
// même identité — recréait exactement ce qu'on venait de supprimer, sans qu'une
// seule erreur ne le signale.
//
// La correction n'est pas locale à ce fichier : elle est LA MÊME primitive que
// celle des writers (`@mip/backend/lib/privacy-barriere.mjs`). L'effacement prend le
// verrou consultatif de l'application, puis lit, puis supprime — et inscrit, si
// l'application a activé la protection, une barrière durable que tous les
// writers consultent.
//
// POURQUOI UN `lock_timeout` PLUS LONG QU'À L'ÉCRITURE. Un writer qui attend
// bloque un beacon : cinq secondes puis un refus rejouable est le bon compromis.
// Un effacement, lui, est une action d'exploitation : il peut attendre, et c'est
// lui qui doit gagner. Trente secondes, puis une erreur explicite — jamais une
// attente sans fin qui immobiliserait une connexion de la console.
const VERROU_DSAR_MS = 30_000;

/**
 * Pose la borne d'attente puis prend le verrou de l'application.
 *
 * À appeler en PREMIER dans la transaction, avant toute lecture : lire avant de
 * verrouiller laisse un writer commiter entre les deux, et le relevé est alors
 * déjà faux quand on s'en sert.
 */
async function verrouillerApp(client: PoolClient, app: string): Promise<void> {
  await client.query(`set local lock_timeout = '${Math.round(VERROU_DSAR_MS)}ms'`);
  await client.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [
    VERROU_INGESTION_NS,
    app,
  ]);
}

/** La migration v81 est-elle appliquée sur cette base ? */
async function protocoleDisponible(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    "select to_regclass('public.privacy_erasure_barrier') is not null as ok",
  );
  return rows[0]?.ok === true;
}

/**
 * L'application a-t-elle ACTIVÉ la protection durable ?
 *
 * `off` par défaut. Sous `off`, aucune barrière n'est écrite : une barrière est
 * elle-même un identifiant pseudonyme, et en conserver un qui ne servira jamais
 * à refuser serait exactement le reproche fait par ailleurs à l'ingestion.
 * Repasser à `off` NE SUPPRIME PAS les barrières déjà posées — un retour arrière
 * ne doit pas lever la protection en silence.
 */
export async function barriereActiveeSur(client: PoolClient, app: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'app_registry'
                       and column_name = 'privacy_barrier_mode') as ok`,
  );
  if (rows[0]?.ok !== true) return false;
  const { rows: mode } = await client.query<{ mode: string }>(
    "select privacy_barrier_mode as mode from app_registry where app_id = $1",
    [app],
  );
  return mode[0]?.mode === "enforce";
}

/** Journal d'audit de la demande — sans identifiant brut ni payload. */
async function ouvrirDemande(
  client: PoolClient,
  app: string,
  acteur: string,
  genre: string,
  cle: string,
): Promise<string | null> {
  if (!(await protocoleDisponible(client))) return null;
  const { rows } = await client.query<{ id: string }>(
    `insert into privacy_erasure_request (app_id, actor, subject_kind, subject_digest, status, started_at)
     values ($1, $2, $3, $4, 'running', now()) returning id::text as id`,
    // 16 caractères : assez pour rapprocher deux traces, pas pour reconstituer
    // la personne. Le brut n'entre jamais dans cette couche.
    [app, acteur, genre, cle.slice(0, 16)],
  );
  return rows[0]?.id ?? null;
}

async function cloreDemande(
  client: PoolClient,
  id: string | null,
  app: string,
  comptes: Record<string, number>,
): Promise<void> {
  if (!id) return;
  // La demande est relue DANS son application (lint des écritures, C9), comme toute ligne d'une app.
  await client.query(
    `update privacy_erasure_request
        set status = 'completed', counts = $2::jsonb, ended_at = now()
      where id = $1::uuid and app_id = $3`,
    [id, JSON.stringify(comptes), app],
  );
}

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

/** Les projections peuvent être appliquées après le déploiement console. */
const DSAR_OPTIONAL_TABLES = new Set(["rum_event_index", "rum_action"]);

async function tableDsarDisponible(table: string): Promise<boolean> {
  if (!DSAR_OPTIONAL_TABLES.has(table)) return true;
  const [row] = await q<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${table}`],
  );
  return row?.present === true;
}

async function tableDsarDisponibleDansTransaction(
  client: PoolClient,
  table: string,
): Promise<boolean> {
  if (!DSAR_OPTIONAL_TABLES.has(table)) return true;
  const { rows } = await client.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${table}`],
  );
  return rows[0]?.present === true;
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
    if (!(await tableDsarDisponible(t))) {
      out.push({ table: t, rows: 0 });
      continue;
    }
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

export type { DsarIdentityKind } from "./dsar";

function identityColumn(kind: DsarIdentityKind): "user_id_hash" | "account_id_hash" {
  return kind === "user" ? "user_id_hash" : "account_id_hash";
}

function identitySessionsSubquery(kind: DsarIdentityKind): string {
  return `select session_id from rum_session where ${identityColumn(kind)} = $2 and app_id = $1`;
}

/** v69 porte l'identité sur rum_error ; avant, seule la session y mène. */
const SQL_ERREUR_IDENTIFIABLE = `select exists(
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'rum_error' and column_name = $1) as present`;

type Lecteur = <T>(text: string, params: unknown[]) => Promise<T[]>;

/**
 * Les exceptions SANS session portent-elles l'identité sur ce schéma ?
 *
 * P5.3 : une exception backend n'est rattachée à une session que si l'ingestion a
 * pu la prouver dans la même app. Sans session, elle reste atteignable par
 * l'identité qu'elle déclare — jamais par la ressemblance d'un message ou d'une
 * stack. Les autres tables enfant n'ont pas de ligne sans session à rattacher.
 */
async function erreursSansSessionIdentifiables(lire: Lecteur, table: string, kind: DsarIdentityKind): Promise<boolean> {
  if (table !== "rum_error") return false;
  const [row] = await lire<{ present: boolean }>(SQL_ERREUR_IDENTIFIABLE, [identityColumn(kind)]);
  return row?.present === true;
}

/** Prédicat de lecture d'une table enfant ($1 = app, $2 = hash) : ses sessions, plus ses exceptions sans session. */
async function identityChildPredicate(lire: Lecteur, table: string, kind: DsarIdentityKind): Promise<string> {
  const parSession = `session_id in (${identitySessionsSubquery(kind)})`;
  return (await erreursSansSessionIdentifiables(lire, table, kind))
    ? `(${parSession} or (app_id = $1 and session_id is null and ${identityColumn(kind)} = $2))`
    : parSession;
}

/** Couture I/O injectable : la production garde q/tx, les tests SQL exercent
 * les fonctions publiques contre leur vraie base jetable, sans faux client. */
export interface IdentityDsarIo {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

const DEFAULT_IDENTITY_IO: IdentityDsarIo = {
  query: q,
  transaction: tx,
};

async function identityTableDisponible(io: IdentityDsarIo, table: string): Promise<boolean> {
  if (!DSAR_OPTIONAL_TABLES.has(table)) return true;
  const [row] = await io.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${table}`],
  );
  return row?.present === true;
}

/** Aperçu DSAR par HMAC déjà calculé ; le brut n'entre jamais dans cette couche. */
export async function dsarIdentityCounts(
  app: string,
  kind: DsarIdentityKind,
  hash: string,
  io: IdentityDsarIo = DEFAULT_IDENTITY_IO,
): Promise<DsarCount[]> {
  const lire: Lecteur = <T,>(text: string, params: unknown[]) => io.query<T>(text, params);
  const out: DsarCount[] = [];
  for (const table of DSAR_CHILD_TABLES) {
    if (!(await identityTableDisponible(io, table))) {
      out.push({ table, rows: 0 });
      continue;
    }
    const [row] = await io.query<{ n: number }>(
      `select count(*)::int as n from ${table} where ${await identityChildPredicate(lire, table, kind)}`,
      [app, hash],
    );
    out.push({ table, rows: row?.n ?? 0 });
  }
  const [session] = await io.query<{ n: number }>(
    `select count(*)::int as n from rum_session where app_id = $1 and ${identityColumn(kind)} = $2`,
    [app, hash],
  );
  out.push({ table: DSAR_ANCHOR, rows: session?.n ?? 0 });
  return out;
}

export async function dsarIdentityExport(
  app: string,
  kind: DsarIdentityKind,
  hash: string,
  generatedAt: string,
  io: IdentityDsarIo = DEFAULT_IDENTITY_IO,
) {
  return io.transaction(async (client) => {
    // Toutes les tables du document sont lues dans le même snapshot : une
    // ingestion concurrente ne peut pas produire un export incohérent.
    await client.query("set transaction isolation level repeatable read, read only");
    const lire: Lecteur = async (text, params) => (await client.query(text, params)).rows;
    const tables: Record<string, unknown[]> = {};
    for (const table of DSAR_CHILD_TABLES) {
      if (!(await tableDsarDisponibleDansTransaction(client, table))) {
        tables[table] = [];
        continue;
      }
      tables[table] = (await client.query(
        `select * from ${table} where ${await identityChildPredicate(lire, table, kind)}`, [app, hash],
      )).rows;
    }
    tables[DSAR_ANCHOR] = (await client.query(
      `select * from rum_session where app_id = $1 and ${identityColumn(kind)} = $2`,
      [app, hash],
    )).rows;
    return buildDsarIdentityExport({ app, identityKind: kind, identityHash: hash, generatedAt, tables });
  });
}

/**
 * Effacement par identité métier (HMAC app-scopé), sérialisé avec l'ingestion.
 *
 * L'ordre n'est pas décoratif :
 *
 *   1. verrou d'application — avant TOUTE lecture ;
 *   2. barrière d'identité, même s'il n'existe encore AUCUNE session : c'est ce
 *      qui ferme le cas « la personne n'est connue que d'un lot en file » ;
 *   3. sessions issues des sources ET des lots aplatis encore en file ;
 *   4. barrières de session pour toutes ;
 *   5. retrait CHIRURGICAL des éléments correspondants dans les lots mixtes ;
 *   6. marquage des heures d'agrégat, AVANT de supprimer les lignes ;
 *   7. suppression des enfants puis de l'ancre ;
 *   8. réconciliation des issues vidées, audit, commit.
 */
export async function dsarIdentityErase(
  app: string,
  kind: DsarIdentityKind,
  hash: string,
  io: IdentityDsarIo = DEFAULT_IDENTITY_IO,
  acteur = "console",
) {
  const column = identityColumn(kind);
  const hashes = kind === "user" ? { user: [hash], account: [] } : { user: [], account: [hash] };
  return io.transaction(async (client) => {
    await verrouillerApp(client, app);
    const protege = await protocoleDisponible(client);
    const barriere = protege && (await barriereActiveeSur(client, app));
    const demande = await ouvrirDemande(client, app, acteur, kind, hash);

    // La barrière d'IDENTITÉ d'abord : une personne peut n'avoir aucune session
    // écrite et n'exister que dans un lot encore en file, ou dans le lot qui
    // arrivera dans deux secondes.
    if (barriere) {
      await client.query("select privacy_poser_barrieres($1, $2, $3::text[], $4::uuid)", [
        app, kind, [hash], demande,
      ]);
    }

    const sessions = await client.query<{ session_id: string }>(
      `select session_id from rum_session where app_id = $1 and ${column} = $2 for update`,
      [app, hash],
    );
    const enFile = protege
      ? (await client.query<{ s: string[] }>(
          "select privacy_sessions_en_file($1, $2::text[], $3::text[]) as s",
          [app, hashes.user, hashes.account],
        )).rows[0]?.s ?? []
      : [];
    const sessionIds = [...new Set([...sessions.rows.map((row) => row.session_id), ...enFile])];

    if (barriere && sessionIds.length) {
      await client.query("select privacy_poser_barrieres($1, 'session', $2::text[], $3::uuid)", [
        app, sessionIds, demande,
      ]);
    }

    // UN LOT MIXTE NE SE SUPPRIME PAS EN ENTIER. On retire les éléments de cette
    // personne et on ne supprime la ligne que si plus rien n'y subsiste : celle
    // qui n'a rien demandé garde ses données.
    let file: Record<string, number> = {};
    if (protege) {
      file = (await client.query<{ r: Record<string, number> }>(
        "select privacy_filtrer_file($1, $2::text[], '{}'::text[], $3::text[], $4::text[]) as r",
        [app, sessionIds, hashes.user, hashes.account],
      )).rows[0]?.r ?? {};
    } else if (sessionIds.length) {
      // Base antérieure à v81 : on retombe sur le comportement historique, qui
      // supprime le lot entier. Moins fin, jamais plus permissif.
      const r = await client.query(
        `delete from ingest_raw where app_id = $1 and exists (
           select 1 from jsonb_array_elements(case
             when jsonb_typeof(lot->'sessions') = 'array' then lot->'sessions'
             else '[]'::jsonb end) queued
            where queued->>'session_id' = any($2::text[]))`,
        [app, sessionIds],
      );
      file = { lots_supprimes: r.rowCount ?? 0 };
    }

    if (protege) {
      await client.query("select privacy_marquer_heures($1, $2::text[], $3::text[], $4::text[])", [
        app, sessionIds, hashes.user, hashes.account,
      ]);
    }

    const lire: Lecteur = async (text, params) => (await client.query(text, params)).rows;
    const deleted: { table: string; deleted: number }[] = [];
    const issues = new Set<string>();
    for (const table of DSAR_CHILD_TABLES) {
      if (!(await tableDsarDisponibleDansTransaction(client, table))) continue;
      // `app_id` lié DANS CHAQUE requête, y compris sur la clause par session :
      // un identifiant de session vient du client, et deux applications peuvent
      // émettre la même valeur.
      const parIdentite = await erreursSansSessionIdentifiables(lire, table, kind);
      const predicat = parIdentite
        ? `app_id = $2 and (session_id = any($1::text[]) or (session_id is null and ${column} = $3))`
        : "app_id = $2 and session_id = any($1::text[])";
      // Les paramètres suivent le prédicat : PostgreSQL refuse un `bind` qui
      // fournit plus de valeurs que la requête n'en cite.
      const params = parIdentite ? [sessionIds, app, hash] : [sessionIds, app];
      const retour = table === "rum_error" && (await colonnePresente(client, "rum_error", "issue_id"))
        ? " returning issue_id"
        : "";
      const result = await client.query<{ issue_id: string | null }>(
        `delete from ${table} where ${predicat}${retour}`,
        params,
      );
      for (const ligne of result.rows) if (ligne.issue_id) issues.add(ligne.issue_id);
      deleted.push({ table, deleted: result.rowCount ?? 0 });
    }
    const anchor = await client.query(
      `delete from rum_session where app_id = $1 and ${column} = $2`,
      [app, hash],
    );
    deleted.push({ table: DSAR_ANCHOR, deleted: anchor.rowCount ?? 0 });

    if (protege && issues.size) {
      await client.query("select privacy_reconcilier_issues($1, $2::uuid[])", [app, [...issues]]);
    }
    await cloreDemande(client, demande, app, {
      ...Object.fromEntries(deleted.map((d) => [d.table, d.deleted])),
      ...file,
      sessions_barrees: barriere ? sessionIds.length : 0,
    });
    return deleted;
  });
}

/**
 * État de la protection durable pour l'écran DSAR.
 *
 * Trois valeurs, et aucune n'est optimiste par défaut : `indisponible` quand la
 * migration n'est pas passée, `off` quand l'exploitant ne l'a pas activée,
 * `enforce` seulement quand elle l'est réellement.
 */
export async function etatBarriere(app: string): Promise<EtatBarriere> {
  if (!app || app === "all") return "indisponible";
  const [present] = await q<{ ok: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'app_registry'
                       and column_name = 'privacy_barrier_mode') as ok`,
  );
  if (present?.ok !== true) return "indisponible";
  const [mode] = await q<{ mode: string | null }>(
    "select privacy_barrier_mode as mode from app_registry where app_id = $1",
    [app],
  );
  return mode?.mode === "enforce" ? "enforce" : "off";
}

/** La colonne existe-t-elle ? (fenêtre code-déployé / migration-appliquée) */
async function colonnePresente(client: PoolClient, table: string, colonne: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = $1 and column_name = $2) as ok`,
    [table, colonne],
  );
  return rows[0]?.ok === true;
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
  // UN EXPORT EST UNE LECTURE. Il n'écrit aucune barrière et ne prend AUCUN
  // verrou d'ingestion : `repeatable read` suffit à rendre un document
  // cohérent — toutes les tables sont lues dans le même instantané, donc une
  // ingestion concurrente ne peut pas produire un enfant sans son ancre. Faire
  // attendre l'ingestion pour une simple lecture serait payer un prix sans rien
  // acheter.
  return tx(async (client) => {
    await client.query("set transaction isolation level repeatable read, read only");
    const tables: Record<string, unknown[]> = {};
    for (const t of DSAR_CHILD_TABLES) {
      if (!(await tableDsarDisponibleDansTransaction(client, t))) {
        tables[t] = [];
        continue;
      }
      tables[t] = (await client.query(
        `select * from ${t} where ($1 = 'all' or app_id = $1) and session_id in (${SESSIONS_SUBQ})`,
        [app, visitorId],
      )).rows;
    }
    tables[DSAR_ANCHOR] = (await client.query(
      `select * from rum_session where ${PERIMETRE}`,
      [app, visitorId],
    )).rows;
    return buildDsarExport({ app, visitorId, generatedAt, tables });
  });
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
  acteur = "console",
): Promise<{ table: string; deleted: number }[]> {
  await exigerRecevable(app, visitorId);
  // Les applications RÉELLEMENT concernées : `all` est une commodité d'écran,
  // pas une portée de verrou. On verrouille chacune, dans l'ordre déterministe
  // de la primitive partagée, avant de lire quoi que ce soit.
  const apps = app === "all"
    ? (await q<{ app_id: string }>(
        `select distinct app_id from rum_session where ${DSAR_ID_COLUMN} = $1`, [visitorId],
      )).map((r) => r.app_id)
    : [app];
  return tx(async (client) => {
    await client.query(`set local lock_timeout = '${Math.round(VERROU_DSAR_MS)}ms'`);
    await client.query(
      `select pg_advisory_xact_lock($1::int4, cle)
         from (select distinct hashtext(a)::int4 as cle from unnest($2::text[]) a order by 1) v`,
      [VERROU_INGESTION_NS, apps],
    );
    const protege = await protocoleDisponible(client);
    const deleted: { table: string; deleted: number }[] = [];
    const sessions = await client.query<{ session_id: string; app_id: string }>(
      `select session_id, app_id from rum_session where ${PERIMETRE} for update`,
      [app, visitorId],
    );
    const sessionIds = sessions.rows.map((s) => s.session_id);

    for (const cible of apps) {
      const barriere = protege && (await barriereActiveeSur(client, cible));
      const demande = await ouvrirDemande(client, cible, acteur, "visitor", visitorId);
      if (barriere) {
        await client.query("select privacy_poser_barrieres($1, 'visitor', $2::text[], $3::uuid)", [
          cible, [visitorId], demande,
        ]);
        const propres = sessions.rows.filter((s) => s.app_id === cible).map((s) => s.session_id);
        // Les sessions encore EN FILE comptent autant que celles déjà écrites :
        // c'est le lot déposé après le relevé qui recréait tout.
        const enFile = (await client.query<{ s: string[] }>(
          "select privacy_sessions_en_file($1, '{}'::text[], '{}'::text[], $2::text[]) as s",
          [cible, [visitorId]],
        )).rows[0]?.s ?? [];
        const toutes = [...new Set([...propres, ...enFile])];
        if (toutes.length) {
          await client.query("select privacy_poser_barrieres($1, 'session', $2::text[], $3::uuid)", [
            cible, toutes, demande,
          ]);
        }
      }
      if (protege) {
        await client.query(
          "select privacy_filtrer_file($1, $2::text[], $3::text[], '{}'::text[], '{}'::text[])",
          [cible, sessionIds, [visitorId]],
        );
        await client.query("select privacy_marquer_heures($1, $2::text[])", [cible, sessionIds]);
      }
      await cloreDemande(client, demande, cible, { sessions: sessionIds.length });
    }

    if (!protege && sessionIds.length) {
      // Base antérieure à v81 : comportement historique, lot entier supprimé.
      await client.query(
        `delete from ingest_raw
          where ($1 = 'all' or app_id = $1)
            and exists (
              select 1
              from jsonb_array_elements(case
                when jsonb_typeof(lot->'sessions') = 'array' then lot->'sessions'
                else '[]'::jsonb end) queued
               where queued->>'session_id' = any($2::text[])
            )`,
        [app, sessionIds],
      );
    }

    const issues = new Set<string>();
    for (const t of DSAR_CHILD_TABLES) {
      if (!(await tableDsarDisponibleDansTransaction(client, t))) {
        deleted.push({ table: t, deleted: 0 });
        continue;
      }
      const retour = t === "rum_error" && (await colonnePresente(client, "rum_error", "issue_id"))
        ? " returning issue_id"
        : "";
      const r = await client.query<{ issue_id: string | null }>(
        `delete from ${t} where ($1 = 'all' or app_id = $1) and session_id in (${SESSIONS_SUBQ})${retour}`,
        [app, visitorId],
      );
      for (const ligne of r.rows) if (ligne.issue_id) issues.add(ligne.issue_id);
      deleted.push({ table: t, deleted: r.rowCount ?? 0 });
    }
    const r = await client.query(
      `delete from rum_session where ${PERIMETRE}`,
      [app, visitorId],
    );
    deleted.push({ table: DSAR_ANCHOR, deleted: r.rowCount ?? 0 });
    if (protege && issues.size) {
      for (const cible of apps) {
        await client.query("select privacy_reconcilier_issues($1, $2::uuid[])", [cible, [...issues]]);
      }
    }
    return deleted;
  });
}
