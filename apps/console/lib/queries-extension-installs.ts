// Inventaire des postes équipés de l'extension navigateur (Ext-D, migration-v52).
// Écriture par le battement de cœur public, lecture par /admin/extension-installs.
import { q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";
import { browserFromUA, browserMajorFromUA, platformFromUA } from "./format";

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

export interface BeatInput {
  installId: string;
  label: string | null;
  version: string | null;
  ua: string | null;
  appIds: string[];
}

/**
 * Enregistre un battement.
 *
 * `app_ids` est FILTRÉ contre `extension_scope` avant écriture : la route est
 * publique et non authentifiée, donc un appelant pourrait sinon rattacher un
 * poste fantôme à n'importe quelle application. Après filtrage, il ne peut se
 * déclarer que sur des applications que l'extension sert vraiment — et un
 * périmètre désactivé cesse d'être déclarable, exactement comme il cesse d'être
 * injecté.
 */
export async function recordInstallBeat(input: BeatInput): Promise<void> {
  const { installId, label, version, ua } = input;

  // `label` est écrasé sans coalesce : si la DSI retire le libellé de sa policy,
  // l'inventaire doit redevenir anonyme au battement suivant. Les autres champs
  // sont préservés quand le battement ne les porte pas (UA absent, version vide).
  await q(
    `insert into extension_install
       (install_id, label, ext_version, browser, browser_major, platform)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (install_id) do update set
       label         = excluded.label,
       ext_version   = coalesce(excluded.ext_version,   extension_install.ext_version),
       browser       = coalesce(excluded.browser,       extension_install.browser),
       browser_major = coalesce(excluded.browser_major, extension_install.browser_major),
       platform      = coalesce(excluded.platform,      extension_install.platform),
       last_seen_at  = now()`,
    [
      installId,
      label,
      version,
      ua ? browserFromUA(ua) : null,
      ua ? browserMajorFromUA(ua) : null,
      ua ? platformFromUA(ua) : null,
    ],
  );

  if (input.appIds.length === 0) return;

  await q(
    `insert into extension_install_app (install_id, app_id)
     select $1, s.app_id
       from (select distinct app_id from extension_scope where active) s
      where s.app_id = any($2::text[])
     on conflict (install_id, app_id) do update set last_seen_at = now()`,
    [installId, input.appIds],
  );
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
