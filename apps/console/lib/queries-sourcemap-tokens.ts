// Jetons de CI (P5.4, C11) — gestion admin.
//
// Distincts des jetons de lecture (`read_tokens`, CONSOLE_API_TOKENS) : UN
// privilège par jeton — `sourcemaps:write` (upload de source maps) ou, depuis
// migration-v92, `deploys:write` (marqueur de déploiement) —, une app, une date
// d'expiration. Le secret n'est
// rendu qu'à la création ; la base n'en garde que le hash, et la vérification
// (commune aux deux ports d'upload) vit dans `@mip/backend/lib/sourcemap-upload.mjs`.
// Rotation : créer un nouveau jeton, basculer la CI, révoquer l'ancien — jamais
// prolonger un jeton existant.
import { EXPIRATION_JETON, genererJetonUpload, PRIVILEGE_JETON, PRIVILEGES_JETON } from "@mip/backend/lib/sourcemap-upload.mjs";
import { hasControlCharacters } from "@mip/backend/shared/sourcemap.mjs";
import { q, tx } from "./db";

/** Ce que l'admin voit d'un jeton : jamais son secret ni son hash. */
/** Le privilège d'un jeton de CI : un seul par jeton. */
export type PrivilegeJeton = (typeof PRIVILEGES_JETON)[number];

export interface SourcemapToken {
  id: string;
  name: string;
  appId: string;
  scope: PrivilegeJeton;
  createdAt: Date | string;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
  lastUsedAt: Date | string | null;
}

export type TokenRequest =
  | { ok: true; appId: string; name: string; expiresInDays: number; scope: PrivilegeJeton }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const COLONNES = `id::text as "id", name as "name", app_id as "appId", scope as "scope", created_at as "createdAt",
  expires_at as "expiresAt", revoked_at as "revokedAt", last_used_at as "lastUsedAt"`;

/** Valide `{ appId, name, expiresInDays? }` (1..90 jours, 30 par défaut). Pure. */
export function parseTokenRequest(body: unknown): TokenRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "objet JSON attendu" };
  }
  const { appId, name, expiresInDays, scope } = body as Record<string, unknown>;
  const app = typeof appId === "string" ? appId.trim() : "";
  if (!app || app.length > 200 || hasControlCharacters(app)) return { ok: false, error: "appId requis" };
  const nom = typeof name === "string" ? name.trim() : "";
  if (!nom || nom.length > 100 || hasControlCharacters(nom)) {
    return { ok: false, error: "name requis (100 caractères au plus)" };
  }
  const jours = expiresInDays === undefined ? EXPIRATION_JETON.defaut : expiresInDays;
  if (typeof jours !== "number" || !Number.isInteger(jours) || jours < EXPIRATION_JETON.min || jours > EXPIRATION_JETON.max) {
    return {
      ok: false,
      error: `expiresInDays : entier de ${EXPIRATION_JETON.min} à ${EXPIRATION_JETON.max} jours (défaut ${EXPIRATION_JETON.defaut})`,
    };
  }
  const privilege = scope === undefined ? PRIVILEGE_JETON : scope;
  if (!(PRIVILEGES_JETON as readonly unknown[]).includes(privilege)) {
    return { ok: false, error: `scope : ${PRIVILEGES_JETON.join(" ou ")}` };
  }
  return { ok: true, appId: app, name: nom, expiresInDays: jours, scope: privilege as PrivilegeJeton };
}

/** Jetons d'une app (ou de toutes), actifs d'abord. */
export async function listSourcemapTokens(appId: string | null): Promise<SourcemapToken[]> {
  return q<SourcemapToken>(
    `select ${COLONNES} from sourcemap_upload_token
      where ($1::text is null or app_id = $1)
      order by (revoked_at is null and expires_at > now()) desc, created_at desc
      limit 200`,
    [appId],
  );
}

/**
 * Crée un jeton et trace la création dans le même geste. `null` si l'app est
 * inconnue du registre. Le secret rendu ne sera plus jamais lisible.
 */
export async function createSourcemapToken(
  request: { appId: string; name: string; expiresInDays: number; scope?: PrivilegeJeton },
  adminEmail: string,
  /** La ligne d'audit de la commande (C9), dans la transaction ; absente, l'action historique. */
  auditer?: (client: import("pg").PoolClient, detail: string) => Promise<void>,
): Promise<{ token: SourcemapToken; secret: string } | null> {
  const { id, jeton, empreinte } = genererJetonUpload();
  return tx(async (client) => {
    const { rowCount } = await client.query("select 1 from app_registry where app_id = $1", [request.appId]);
    if (!rowCount) return null;
    const {
      rows: [token],
    } = await client.query<SourcemapToken>(
      `insert into sourcemap_upload_token (id, app_id, name, secret_hash, scope, created_by, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
       returning ${COLONNES}`,
      [id, request.appId, request.name, empreinte, request.scope ?? PRIVILEGE_JETON, adminEmail, request.expiresInDays],
    );
    const detail = JSON.stringify({ id, app_id: request.appId, name: request.name, scope: token.scope, expires_at: token.expiresAt });
    if (auditer) await auditer(client, detail);
    else await client.query("insert into audit_log (user_email, action, detail) values ($1, 'sourcemap_token_create', $2)", [adminEmail, detail]);
    return { token, secret: jeton };
  });
}

/**
 * Révoque un jeton (idempotent) et trace la révocation effective. `null` si le
 * jeton n'existe pas ; un jeton déjà révoqué est rendu tel quel, sans nouvel audit.
 */
export async function revokeSourcemapToken(
  id: string,
  adminEmail: string,
  /** C9 : le jeton est cherché DANS cette application ; `null` : dans toutes (appel historique). */
  appId: string | null = null,
  auditer?: (client: import("pg").PoolClient, detail: string) => Promise<void>,
): Promise<SourcemapToken | null> {
  if (!UUID.test(id)) return null;
  return tx(async (client) => {
    const {
      rows: [revoque],
    } = await client.query<SourcemapToken>(
      `update sourcemap_upload_token set revoked_at = now(), revoked_by = $2
        where id = $1 and ($3::text is null or app_id = $3) and revoked_at is null
        returning ${COLONNES}`,
      [id, adminEmail, appId],
    );
    if (revoque) {
      const detail = JSON.stringify({ id, app_id: revoque.appId, name: revoque.name });
      if (auditer) await auditer(client, detail);
      else await client.query("insert into audit_log (user_email, action, detail) values ($1, 'sourcemap_token_revoke', $2)", [adminEmail, detail]);
      return revoque;
    }
    const {
      rows: [existant],
    } = await client.query<SourcemapToken>(`select ${COLONNES} from sourcemap_upload_token where id = $1 and ($2::text is null or app_id = $2)`, [
      id,
      appId,
    ]);
    return existant ?? null;
  });
}
