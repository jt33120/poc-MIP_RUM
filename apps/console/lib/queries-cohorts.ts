// Rétention par cohortes — couche I/O (Lot 8c). Récupère les semaines d'activité
// DISTINCTES par visiteur sur une fenêtre en SEMAINES (indépendante du filtre
// période court), puis délègue à la logique pure (lib/cohorts). Respecte segment
// + bots + app/device.
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
import { q } from "./db";
import { buildCohorts, type CohortRow } from "./cohorts";
import type { Filters } from "./filters";
import { buildSegment } from "./segments";

const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

/** Secondes par semaine (index de semaine = epoch/604800). */
const WEEK_SECONDS = 604800;

/** Matrice de rétention sur `weeks` dernières semaines (offset max = weeks-1). */
export async function retentionCohorts(f: Filters, weeks: number): Promise<CohortRow[]> {
  const seg = buildSegment(f.segment, 4);
  const rows = await q<{ user: string; week: number }>(
    `select distinct s.visitor_id as user,
            floor(extract(epoch from date_trunc('week', s.started_at)) / ${WEEK_SECONDS})::int as week
     from rum_session s
     where s.visitor_id is not null
       and s.started_at > now() - ($3 || ' weeks')::interval
       and ($1::text is null or s.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}`,
    [f.app, f.device, weeks, ...seg.params],
  );
  return buildCohorts(rows, Math.max(0, weeks - 1));
}

/** Convertit un index de semaine en date (lundi) — pour l'étiquetage côté page. */
export function weekIndexToDate(week: number): Date {
  return new Date(week * WEEK_SECONDS * 1000);
}
