// LA LIGNE D'AUDIT D'UNE COMMANDE, dans la transaction de son écriture.
//
// `audit_log` gagne en migration-v90 l'identifiant de la requête, la nature de
// l'acteur et l'application concernée — et devient AJOUT SEUL (déclencheur). Tant
// que v90 n'est pas appliquée en production (elle attend sa répétition sur une
// branche Neon), la console publiée doit continuer d'écrire : la présence des
// colonnes est SONDÉE, comme celle des colonnes de propriété des tableaux de bord
// (v79). Sans elles, la ligne s'écrit sous sa forme d'avant — même action, même
// détail.
import { q } from "../db";

/** Ce qu'une transaction offre à une commande : `query` sur SON client. */
export interface Requetable {
  query(texte: string, valeurs?: unknown[]): Promise<unknown>;
}

const SONDE_TTL_MS = 5_000;
let sonde: { at: number; value: Promise<boolean> } | null = null;

/** migration-v90 est-elle appliquée à `audit_log` ? Mémoire courte : une migration se voit sans redémarrage. */
export function auditV90Disponible(): Promise<boolean> {
  const now = Date.now();
  if (sonde && now - sonde.at < SONDE_TTL_MS) return sonde.value;
  const value = q<{ ok: boolean }>(
    `select count(*) = 3 as ok from information_schema.columns
      where table_schema = 'public' and table_name = 'audit_log' and column_name in ('request_id', 'actor_kind', 'app_id')`,
  ).then((rows) => rows[0]?.ok === true);
  sonde = { at: now, value };
  value.catch(() => {
    if (sonde?.value === value) sonde = null;
  });
  return value;
}

/** Oublie la sonde — pour les tests SQL qui migrent une base en cours de suite. */
export function oublierSondeAudit(): void {
  sonde = null;
}

/** Une ligne d'audit : acteur (un compte : une démo n'écrit jamais), action de la règle, détail, requête, application. */
export async function ecrireAudit(
  client: Requetable,
  l: { email: string; action: string; detail: string | null; requestId: string | null; app: string | null },
): Promise<void> {
  if (await auditV90Disponible()) {
    await client.query(
      "insert into audit_log (user_email, action, detail, request_id, actor_kind, app_id) values ($1, $2, $3, $4, 'user', $5)",
      [l.email, l.action, l.detail, l.requestId, l.app],
    );
    return;
  }
  await client.query("insert into audit_log (user_email, action, detail) values ($1, $2, $3)", [l.email, l.action, l.detail]);
}
