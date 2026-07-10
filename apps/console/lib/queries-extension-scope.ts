// Registre domaine -> app_id (Ext-A migration v27) : résolution pour l'extension
// navigateur, gestion admin. Zéro PII (juste un mapping hostname -> app_id).
import { q } from "./db";

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
  const [row] = await q<{ app_id: string; endpoint: string | null; active: boolean }>(
    `select app_id, endpoint, active from extension_scope where domain = $1 and active limit 1`,
    [domain],
  );
  return row ?? null;
}

/** Liste complète (admin) — tous statuts, la plus récente en premier. */
export async function listExtensionScopes(): Promise<ExtensionScopeRow[]> {
  return q<ExtensionScopeRow>(
    `select id, domain, app_id, endpoint, active, created_at
     from extension_scope order by created_at desc`,
  );
}

/** Enregistre un domaine (upsert par hostname exact) — active par défaut. */
export async function createExtensionScope(domain: string, appId: string): Promise<void> {
  await q(
    `insert into extension_scope (domain, app_id) values ($1, $2)
     on conflict (domain) do update set app_id = excluded.app_id, active = true`,
    [domain, appId],
  );
}

/** Bascule active/inactive (kill-switch sans supprimer la ligne). */
export async function toggleExtensionScope(id: number, active: boolean): Promise<void> {
  await q(`update extension_scope set active = $2 where id = $1`, [id, active]);
}
