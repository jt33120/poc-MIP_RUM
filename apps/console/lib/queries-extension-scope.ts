// Registre domaine -> app_id (Ext-A migration v27) : résolution pour l'extension
// navigateur, gestion admin. Zéro PII (juste un mapping hostname -> app_id).
import { resoudreDomaine } from "@mip/backend/lib/extension-parc.mjs";
import { pool, q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";

export interface ExtensionScopeRow {
  id: number;
  domain: string;
  app_id: string;
  endpoint: string | null;
  active: boolean;
  created_at: string;
}

/** Résolution pour l'extension : domaine actif -> {app_id, endpoint} ou null. */
export async function resolveExtensionScope(
  domain: string,
): Promise<{ app_id: string; endpoint: string | null; active: boolean } | null> {
  // La requête est celle du collector (C11), partagée : `@mip/backend/lib/extension-parc.mjs`.
  return resoudreDomaine(pool, domain);
}

/** Liste complète (admin) — tous statuts, la plus récente en premier. */
export async function listExtensionScopes(): Promise<ExtensionScopeRow[]> {
  return q<ExtensionScopeRow>(
    `select id, domain, app_id, endpoint, active, created_at
     from extension_scope order by created_at desc`,
  );
}

/** Enregistre un domaine (upsert par hostname exact) — active par défaut. */
export async function createExtensionScope(domain: string, appId: string, client?: ClientEcriture): Promise<void> {
  await ecrire(
    client,
    `insert into extension_scope (domain, app_id) values ($1, $2)
     on conflict (domain) do update set app_id = excluded.app_id, active = true`,
    [domain, appId],
  );
}

/** L'application à laquelle un domaine est déjà rattaché, s'il l'est (C9 : un domaine ne change pas d'app à l'insu de la sienne). */
export async function appDuDomaine(domain: string, client?: ClientEcriture): Promise<string | null> {
  const { rows } = await ecrire<{ app_id: string }>(client, "select app_id from extension_scope where domain = $1", [domain]);
  return rows[0]?.app_id ?? null;
}

/**
 * Autorise l'origine HTTPS d'un domaine à poster vers l'ingestion (CORS).
 * Sans cette entrée dans `app_registry.allowed_origins`, le préflight OPTIONS
 * renvoie 204 SANS `Access-Control-Allow-Origin` et le POST OTLP de l'extension
 * est bloqué par le navigateur (cause racine du « domaine enregistré mais tableau
 * vide »). Idempotent : n'ajoute l'origine que si elle est absente. Ne retire
 * jamais (une origine peut aussi servir au SDK embarqué de l'app). No-op si
 * l'app n'existe pas dans `app_registry`.
 */
export async function allowOriginForApp(domain: string, appId: string, client?: ClientEcriture): Promise<void> {
  const origin = `https://${domain}`;
  await ecrire(
    client,
    `update app_registry
        set allowed_origins =
          case when $2 = any(coalesce(allowed_origins, '{}'::text[]))
               then allowed_origins
               else coalesce(allowed_origins, '{}'::text[]) || $2 end
      where app_id = $1`,
    [appId, origin],
  );
}

/** Active ou coupe un domaine de l'application `appId` (kill-switch sans supprimer la ligne) ; `false` s'il n'y est pas. */
export async function toggleExtensionScope(id: number, appId: string, active: boolean, client?: ClientEcriture): Promise<boolean> {
  const { rowCount } = await ecrire(client, `update extension_scope set active = $3 where id = $1 and app_id = $2`, [id, appId, active]);
  return rowCount > 0;
}
