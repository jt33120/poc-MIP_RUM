// Objectifs & conversions — couche I/O (Lot 8b). Liste les objectifs (par app),
// calcule le nombre de sessions de la fenêtre (dénominateur) et, par objectif, le
// nombre de sessions ayant satisfait la condition (route ou événement). Le pattern
// est une VALEUR paramétrée ($3), jamais interpolée. Respecte segment + bots +
// app/device/période.
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";
import { buildSegment } from "./segments";
import type { GoalConversion, GoalDef } from "./goals";
import { conversionRate } from "./goals";

const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

/** Objectifs d'une app (ou toutes si f.app null), actifs d'abord. */
export async function listGoals(app: string | null): Promise<GoalDef[]> {
  return q<GoalDef>(
    `select id::int as id, app_id, name, kind, pattern, match_type, active
     from goal
     where ($1::text is null or app_id = $1)
     order by active desc, name`,
    [app],
  );
}

/** Sessions de la fenêtre ayant vu au moins une page (dénominateur des taux). */
async function windowSessions(f: Filters): Promise<number> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  const [r] = await q<{ n: number }>(
    `select count(distinct p.session_id)::int as n
     from rum_pageview p
     join rum_session s on s.session_id = p.session_id
     where p.started_at > now() - interval '${itv}'
       and ($1::text is null or p.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}`,
    [f.app, f.device, ...seg.params],
  );
  return r?.n ?? 0;
}

/** Sessions ayant satisfait un objectif (page vue ou événement). */
async function goalHits(f: Filters, goal: GoalDef): Promise<number> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 4);
  // table/colonne = constantes selon le type (jamais une entrée utilisateur).
  const table = goal.kind === "event" ? "rum_event" : "rum_pageview";
  const col = goal.kind === "event" ? "name" : "route";
  const tsCol = goal.kind === "event" ? "ts" : "started_at";
  // Correspondance : exact => égalité ; contains => sous-chaîne (pattern = valeur $3).
  const cond =
    goal.match_type === "contains"
      ? `position($3 in coalesce(ev.${col}, '')) > 0`
      : `ev.${col} = $3`;
  const [r] = await q<{ n: number }>(
    `select count(distinct ev.session_id)::int as n
     from ${table} ev
     join rum_session s on s.session_id = ev.session_id
     where ev.${tsCol} > now() - interval '${itv}'
       and ($1::text is null or ev.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
       and ${cond}`,
    [f.app, f.device, goal.pattern, ...seg.params],
  );
  return r?.n ?? 0;
}

/** Report de conversion : total sessions + par objectif (conversions + taux). */
export async function goalConversions(
  f: Filters,
): Promise<{ total: number; rows: GoalConversion[] }> {
  const goals = (await listGoals(f.app)).filter((g) => g.active);
  const total = await windowSessions(f);
  const rows: GoalConversion[] = [];
  for (const g of goals) {
    const conversions = await goalHits(f, g);
    rows.push({ ...g, conversions, rate: conversionRate(conversions, total) });
  }
  rows.sort((a, b) => b.conversions - a.conversions || (a.name < b.name ? -1 : 1));
  return { total, rows };
}
