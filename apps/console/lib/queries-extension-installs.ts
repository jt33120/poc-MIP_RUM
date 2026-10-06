// Inventaire des postes équipés de l'extension navigateur (Ext-D, migration-v52).
// Écriture par le battement de cœur public, au collector (C12) ; lecture par
// /admin/extension-installs.
import { q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";

export interface InstallRow {
  install_id: string;
  /** Libellé poussé par la policy d'entreprise du client. null = parc anonyme. */
  label: string | null;
  ext_version: string | null;
  browser: string | null;
  browser_major: number | null;
  platform: string | null;
  first_seen_at: string;
  last_seen_at: string;
  /** Applications que ce poste alimente réellement (peut être vide). */
  app_ids: string[];
}

/** Inventaire complet, poste le plus récemment vu en premier. */
export async function listInstalls(): Promise<InstallRow[]> {
  return q<InstallRow>(
    `select i.install_id, i.label, i.ext_version, i.browser, i.browser_major, i.platform,
            i.first_seen_at, i.last_seen_at,
            coalesce(
              array_agg(a.app_id order by a.app_id) filter (where a.app_id is not null),
              '{}'::text[]
            ) as app_ids
       from extension_install i
       left join extension_install_app a using (install_id)
      group by i.install_id
      order by i.last_seen_at desc`,
  );
}

/**
 * Retire un poste de l'inventaire. La cascade emporte ses liaisons. Un poste n'a
 * pas d'application : il en observe plusieurs — l'oublier est un geste de
 * l'administrateur de la plateforme (C9). `false` s'il est inconnu.
 */
export async function forgetInstall(installId: string, client?: ClientEcriture): Promise<boolean> {
  const { rowCount } = await ecrire(client, `delete from extension_install where install_id = $1`, [installId]);
  return rowCount > 0;
}
