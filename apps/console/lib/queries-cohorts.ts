// Rétention par cohortes — couche I/O (Lot 8c). Récupère les semaines d'activité
// DISTINCTES par utilisateur (user_hash anonymisé) sur une fenêtre en SEMAINES
// (indépendante du filtre période court), puis délègue à la logique pure
// (lib/cohorts). Respecte segment + bots + app/device.
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
    `select distinct s.user_hash as user,
            floor(extract(epoch from date_trunc('week', s.started_at)) / ${WEEK_SECONDS})::int as week
     from rum_session s
     where s.user_hash is not null
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
