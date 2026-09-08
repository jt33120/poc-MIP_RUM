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

/** Date du dernier passage QUOTIDIEN abouti, ou null si aucun n'a jamais eu lieu. */
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

/**
 * Date du dernier TICK abouti du scheduler, ou null.
 *
 * TÉMOIN : `scheduler_lease`. Le bail d'exclusion des travaux planifiés est
 * relâché en faisant EXPIRER la ligne plutôt qu'en la supprimant, exprès pour
 * laisser ce battement de cœur (cf. ingest/jobs/bail.mjs). `max(expires_at)`
 * pour la cadence `tick` est donc l'heure de fin du dernier passage.
 *
 * C'est ce qui permet à la vitrine de dire la latence d'alerte RÉELLE au lieu de
 * l'affirmer en dur. Elle a affiché « 60 minutes » pendant tout le temps où
 * c'était vrai ; le jour où un déclencheur dédié est arrivé, une phrase statique
 * serait devenue fausse en silence — exactement ce qui s'était produit pour la
 * purge de rétention.
 */
export async function dernierTickScheduler(): Promise<Date | null> {
  try {
    const [row] = await q<{ t: string | null }>(
      `select max(expires_at)::text as t from scheduler_lease where job = 'tick'`,
    );
    return row?.t ? new Date(row.t) : null;
  } catch {
    // Table absente (scheduler jamais déployé) ou base injoignable : on ne peut
    // rien prouver, donc on n'affirme rien.
    return null;
  }
}
