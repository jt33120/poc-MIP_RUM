// Acquisition — couche I/O (Lot 8a). Récupère l'ENTRÉE de chaque session (referrer
// + url de la 1re page vue) et délègue la classification/agrégation à la logique
// pure (lib/acquisition). Respecte segment + bots + app/device/période. Cap de
// sécurité sur le nombre de sessions rapatriées.
import { q } from "./db";
import { acquisitionReport, type AcquisitionReport } from "./acquisition";
import { type Filters, PERIODS } from "./filters";
import { buildSegment } from "./segments";

const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

/** Report d'acquisition (canaux + top référents) sur la fenêtre. */
export async function acquisition(f: Filters, cap = 20000): Promise<AcquisitionReport> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  const rows = await q<{ referrer: string | null; url: string | null }>(
    `select distinct on (p.session_id) p.referrer, p.url
     from rum_pageview p
     join rum_session s on s.session_id = p.session_id
     where p.started_at > now() - interval '${itv}'
       and ($1::text is null or p.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     order by p.session_id, p.started_at asc, p.id asc
     limit $3`,
    [f.app, f.device, cap, ...seg.params],
  );
  return acquisitionReport(rows);
}
