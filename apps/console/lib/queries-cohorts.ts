// Rétention par cohortes — couche I/O (Lot 8c ; périmètre et filtres du contrat
// depuis B31, plan § 6.3). Récupère les semaines d'activité DISTINCTES par visiteur
// sur une fenêtre en SEMAINES (indépendante de la plage du haut : la surface est en
// `range: "none"`), puis délègue à la logique pure (lib/cohorts).
//
// LA CLÉ EST `visitor_id`, PAS `user_hash`. Une cohorte de rétention répond à
// « les gens reviennent-ils ? ». Avec l'ancienne empreinte de terminal, une
// cohorte regroupait des CLASSES D'APPAREIL : tout un parc homogène formait une
// ligne unique, éternellement retenue puisqu'un poste quelconque du parc
// repassait chaque semaine. La matrice affichait de la fidélité là où il n'y
// avait qu'un modèle de PC. Voir migration-v57.
//
// Les sessions sans identifiant sont exclues — l'historique antérieur au
// 09/09/2026 disparaît donc de la matrice au lieu d'y figurer faussement.
//
// B31. Le filtre « app demandée, ou toutes si elle est nulle » laissait passer
// toutes les apps de la base sous `app=all` ; périmètre (apps EFFECTIVES),
// conditions (tablette et « Inconnu » compris) et bots passent désormais par
// `sqlContext(f)`, SANS fenêtre du contrat (`time: null`) : la fenêtre est celle
// des N semaines choisies dans l'écran, liée en paramètre.
import { q } from "./db";
import { buildCohorts, SEMAINE_S, type CohortRow } from "./cohorts";
import { queryOf, type FiltersLike } from "./filters";
import type { Device } from "./query-contract";
import { sqlContext } from "./query-sql";

/** Secondes par semaine (index de semaine = epoch(lundi)/604800) : étiquette par `lundiDeSemaine`. */
const WEEK_SECONDS = SEMAINE_S;

/** Fenêtre de rétention lisible : un entier de semaines, au plus un an. */
export function semainesValides(weeks: number): boolean {
  return Number.isSafeInteger(weeks) && weeks >= 1 && weeks <= 53;
}

/**
 * Matrice de rétention sur `weeks` dernières semaines (offset max = weeks-1).
 *
 * `appareil` (figure « Par appareil ») : la même lecture restreinte à un type
 * d'appareil. Il REMPLACE l'appareil de la requête résolue — recopier
 * `{ ...f, device }` ne suffisait plus : sur le contrat, la population est lue dans
 * `f.query`, pas dans la façade historique.
 */
export async function retentionCohorts(
  f: FiltersLike,
  weeks: number,
  options: { appareil?: Device } = {},
): Promise<CohortRow[]> {
  if (!semainesValides(weeks)) throw new Error("fenêtre de rétention invalide");
  const query = queryOf(f);
  const sql = await sqlContext(
    options.appareil ? { ...f, device: options.appareil, query: { ...query, filters: { ...query.filters, device: options.appareil } } } : f,
  );
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: null });
  const semaines = sql.bind(weeks);
  const rows = await q<{ user: string; week: number }>(
    `select distinct s.visitor_id as user,
            floor(extract(epoch from date_trunc('week', s.started_at)) / ${WEEK_SECONDS})::int as week
       from rum_session s
      where s.visitor_id is not null
        and s.started_at > now() - ${semaines}::int * interval '1 week'${where}`,
    sql.params,
  );
  return buildCohorts(rows, Math.max(0, weeks - 1));
}

// `weekIndexToDate` a disparu (F40) : `index × 604800` tombe un JEUDI, et chaque
// cohorte était datée du jeudi de la semaine PRÉCÉDENTE. L'étiquetage passe par
// `lundiDeSemaine` (lib/cohorts.ts, pur et testé).
