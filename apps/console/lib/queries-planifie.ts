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
import { cadencePubliee } from "./etat-latence";
import type { LecturePlanifie } from "./etat-planifie";

/**
 * Date du dernier passage QUOTIDIEN abouti (`date: null` s'il n'a jamais eu lieu),
 * ou `illisible` si la lecture a échoué.
 */
export async function dernierPassagePlanifie(): Promise<LecturePlanifie> {
  try {
    const [row] = await q<{ t: string | null }>(
      `select max(metered_at)::text as t from tenant_usage_daily`,
    );
    return { etat: "lu", date: row?.t ? new Date(row.t) : null };
  } catch {
    // Table absente (base non migrée) ou base injoignable : on ne peut rien
    // prouver, ni dans un sens ni dans l'autre — surtout pas « jamais exécuté ».
    return { etat: "illisible" };
  }
}

/**
 * Date du dernier TICK abouti du scheduler (`date: null` s'il n'y en a jamais eu),
 * ou `illisible` si la lecture a échoué.
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
export async function dernierTickScheduler(): Promise<LecturePlanifie> {
  let date: Date | null;
  try {
    const [row] = await q<{ t: string | null }>(
      `select max(expires_at)::text as t from scheduler_lease where job = 'tick'`,
    );
    date = row?.t ? new Date(row.t) : null;
  } catch {
    // Table absente (scheduler jamais déployé) ou base injoignable : on ne peut
    // rien prouver, donc on n'affirme rien.
    return { etat: "illisible" };
  }
  return { etat: "lu", date, cadenceMin: await cadenceTickPubliee() };
}

/**
 * La cadence EFFECTIVE du tick, publiée par le scheduler
 * (`platform_flag.scheduler_tick_min`), ou `null` : pas encore publiée, hors
 * grille, ou illisible. Lecture À PART du battement : avant migration-v87,
 * `platform_flag` n'existe pas, et ce n'est pas une raison de perdre le reste.
 */
export async function cadenceTickPubliee(): Promise<number | null> {
  try {
    const [row] = await q<{ value: string }>(`select value from platform_flag where key = 'scheduler_tick_min'`);
    return cadencePubliee(row?.value);
  } catch {
    return null;
  }
}
