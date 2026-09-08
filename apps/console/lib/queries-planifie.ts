// Preuve qu'une tâche planifiée s'est réellement exécutée en production.
//
// POURQUOI UNE REQUÊTE PLUTÔT QU'UNE PHRASE. La vitrine affirmait « jamais
// déclenchée en production ». C'était vrai à l'écriture, ça a cessé de l'être dès
// que le secret du planificateur a été posé — sans que personne ne le remarque.
// Une affirmation datée dans du texte statique périme en silence ; celle-ci est
// relue à chaque rendu et ne peut donc pas mentir dans un sens ni dans l'autre.
//
// TÉMOIN : `tenant_usage_daily.metered_at`, posé par meter_tenant_usage() —
// le job quotidien qui accompagne la purge de rétention. Il est écrit à CHAQUE
// passage, indépendamment de ce que la télémétrie contient.
//
// Écartés : `alert_event` ne se remplit que si une règle FRANCHIT son seuil, donc
// son absence ne prouve rien ; `rum_rollup_hourly` n'a pas de colonne d'écriture,
// seulement le bucket horaire, qu'un rattrapage rendrait indiscernable d'un
// passage récent.
import { q } from "./db";

/** Date du dernier passage abouti, ou null si aucun n'a jamais eu lieu. */
export async function dernierPassagePlanifie(): Promise<Date | null> {
  try {
    const [row] = await q<{ t: string | null }>(
      `select max(metered_at)::text as t from tenant_usage_daily`,
    );
    return row?.t ? new Date(row.t) : null;
  } catch {
    // Table absente (base non migrée) ou base injoignable : on ne peut rien
    // prouver, donc on n'affirme rien — l'appelant traite null comme « inconnu ».
    return null;
  }
}
