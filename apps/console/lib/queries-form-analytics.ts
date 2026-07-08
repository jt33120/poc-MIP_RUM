// Form Analytics — couche I/O (Lot 7b). Lit les événements rum_event
// `form.submit` / `form.abandon` (émis par le SDK, Lot 7a) et les rend au format
// FormEvent pour l'agrégation pure (lib/form-analytics). Respecte segment + bots
// + app/device/période. Cap de sécurité sur le volume rapatrié.
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";
import { buildSegment } from "./segments";
import type { FormEvent, FormEventProps } from "./form-analytics";

const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

/** Événements de formulaire sur la fenêtre (submit + abandon), filtrés. */
export async function formEvents(f: Filters, limit = 5000): Promise<FormEvent[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  const rows = await q<{ name: string; props: FormEventProps | null }>(
    `select e.name, e.props
     from rum_event e
     join rum_session s on s.session_id = e.session_id
     where e.ts > now() - interval '${itv}'
       and e.name in ('form.submit', 'form.abandon')
       and ($1::text is null or e.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     order by e.ts desc
     limit $3`,
    [f.app, f.device, limit, ...seg.params],
  );
  return rows.map((r) => ({ name: r.name, props: r.props ?? {} }));
}
