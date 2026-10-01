// Jetons d'accès — couche I/O. Résolution à l'auth (par hash, non révoqué, non
// échu) + gestion admin (liste / création / révocation). Le jeton en clair n'est
// jamais stocké ni relu : seul son hash circule ici.
//
// L'ÉCHÉANCE (`read_tokens.expires_at`) arrive par une migration additive. Tant
// qu'elle n'est pas appliquée, la console publiée doit continuer de lire et
// d'écrire : la colonne est lue par `to_jsonb(t) ->> 'expires_at'` (NULL si elle
// n'existe pas, sans erreur), et SONDÉE avant une écriture qui la renseigne. Un
// jeton sans échéance (créé avant elle) reste valable jusqu'à sa révocation.
import { q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";
import { hashToken } from "./read-tokens";

/** Échéance d'une ligne, que la colonne existe ou non. */
const ECHEANCE = "(to_jsonb(t) ->> 'expires_at')::timestamptz";

/** Résout un jeton présenté -> app_id autorisé, ou null (inconnu, révoqué ou échu). */
export async function resolveReadToken(token: string): Promise<{ id: number; app_id: string } | null> {
  const [r] = await q<{ id: number; app_id: string }>(
    `select id::int as id, app_id from read_tokens t
      where token_hash = $1 and revoked_at is null
        and coalesce(${ECHEANCE}, 'infinity'::timestamptz) > now()`,
    [hashToken(token)],
  );
  return r ?? null;
}

export interface ReadTokenRow {
  id: number;
  app_id: string;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
  /** Échéance ; null = jeton créé sans échéance (avant qu'elle n'existe). */
  expires_at: string | null;
}

/** Liste des jetons (actifs d'abord) pour l'admin. */
export async function listReadTokens(): Promise<ReadTokenRow[]> {
  return q<ReadTokenRow>(
    `select id::int as id, app_id, label, created_at, revoked_at, ${ECHEANCE} as expires_at
     from read_tokens t order by revoked_at nulls first, created_at desc`,
  );
}

const SONDE = `select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'read_tokens' and column_name = 'expires_at') as ok`;

/** L'échéance est-elle en base ? L'écran ne propose une durée que si elle sera tenue. */
export async function echeanceLectureDisponible(client?: ClientEcriture): Promise<boolean> {
  const { rows } = await ecrire<{ ok: boolean }>(client, SONDE, []);
  return rows[0]?.ok === true;
}

/**
 * Crée un jeton : persiste son hash (le clair est affiché une fois par l'appelant)
 * et son échéance, à `validiteJours` d'aujourd'hui. Rend son identifiant et son
 * échéance — null si la base ne la porte pas encore.
 */
export async function createReadToken(
  appId: string,
  label: string,
  token: string,
  client?: ClientEcriture,
  validiteJours?: number,
): Promise<{ id: string; expire: string | null }> {
  if (validiteJours !== undefined && (await echeanceLectureDisponible(client))) {
    const { rows } = await ecrire<{ id: string; expire: string }>(
      client,
      `insert into read_tokens (token_hash, app_id, label, expires_at)
       values ($1, $2, $3, now() + make_interval(days => $4))
       returning id::text as id, expires_at as expire`,
      [hashToken(token), appId, label || null, validiteJours],
    );
    return rows[0];
  }
  const { rows } = await ecrire<{ id: string }>(
    client,
    `insert into read_tokens (token_hash, app_id, label) values ($1, $2, $3) returning id::text as id`,
    [hashToken(token), appId, label || null],
  );
  return { id: rows[0].id, expire: null };
}

/**
 * Révoque le jeton `id` de l'application `appId` (revoked_at = now), idempotent :
 * `revoque` au passage effectif, `deja` s'il l'était, `introuvable` s'il n'est pas
 * dans cette application.
 */
export async function revokeReadToken(id: number, appId: string, client?: ClientEcriture): Promise<"revoque" | "deja" | "introuvable"> {
  const { rowCount } = await ecrire(
    client,
    `update read_tokens set revoked_at = now() where id = $1 and app_id = $2 and revoked_at is null`,
    [id, appId],
  );
  if (rowCount > 0) return "revoque";
  const { rowCount: existe } = await ecrire(client, `select 1 from read_tokens where id = $1 and app_id = $2`, [id, appId]);
  return existe > 0 ? "deja" : "introuvable";
}
