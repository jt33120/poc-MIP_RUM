// Tokens de lecture — couche I/O (livrable UTI). Résolution à l'auth (par hash,
// non révoqué) + gestion admin (liste / création / révocation). Le token en clair
// n'est jamais stocké ni relu : seul son hash circule ici.
import { q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";
import { hashToken } from "./read-tokens";

/** Résout un token présenté -> app_id autorisé, ou null (inconnu/révoqué). */
export async function resolveReadToken(token: string): Promise<{ id: number; app_id: string } | null> {
  const [r] = await q<{ id: number; app_id: string }>(
    `select id::int as id, app_id from read_tokens where token_hash = $1 and revoked_at is null`,
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
}

/** Liste des tokens (actifs d'abord) pour l'admin. */
export async function listReadTokens(): Promise<ReadTokenRow[]> {
  return q<ReadTokenRow>(
    `select id::int as id, app_id, label, created_at, revoked_at
     from read_tokens order by revoked_at nulls first, created_at desc`,
  );
}

/** Crée un token : persiste son hash (le clair est affiché une fois par l'appelant). Rend son identifiant. */
export async function createReadToken(appId: string, label: string, token: string, client?: ClientEcriture): Promise<string> {
  const { rows } = await ecrire<{ id: string }>(
    client,
    `insert into read_tokens (token_hash, app_id, label) values ($1, $2, $3) returning id::text as id`,
    [hashToken(token), appId, label || null],
  );
  return rows[0].id;
}

/**
 * Révoque le token `id` de l'application `appId` (revoked_at = now), idempotent :
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
