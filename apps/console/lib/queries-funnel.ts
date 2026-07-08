// Entonnoir — couche I/O (Lot 6c) sur rum_event. `availableEvents` liste les
// événements custom disponibles (pour construire un funnel) ; `funnelReport`
// calcule l'entonnoir pour une suite d'étapes ordonnée. Le SQL fournit la 1re
// date de chaque étape par session ; l'ordre/atteinte est décidé par lib/funnel
// (définition de référence pure). Anti-injection : les noms d'étapes sont des
// VALEURS ($3::text[]), jamais interpolés ; $1 app, $2 device, segment à partir de $4.
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";
import { buildSegment } from "./segments";
import { computeFunnel, type FunnelStep } from "./funnel";

const botClause = (f: Filters, alias: string): string =>
  f.includeBots ? "" : ` and not coalesce(${alias}.is_bot, false)`;

export interface EventOption {
  name: string;
  n: number;
  sessions: number;
}

/** Événements custom disponibles sur la fenêtre (pour le sélecteur d'étapes). */
export async function availableEvents(f: Filters, limit = 50): Promise<EventOption[]> {
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 3);
  return q<EventOption>(
    `select e.name,
            count(*)::int as n,
            count(distinct e.session_id)::int as sessions
     from rum_event e
     join rum_session s on s.session_id = e.session_id
     where e.ts > now() - interval '${itv}'
       and ($1::text is null or e.app_id = $1)
       and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
     group by e.name
     order by count(distinct e.session_id) desc, e.name
     limit $3`,
    [f.app, f.device, limit, ...seg.params],
  );
}

/**
 * Rapport d'entonnoir pour une suite d'étapes ORDONNÉE (>= 1). Récupère la 1re
 * date de chaque étape par session (sessions ayant réalisé l'étape 1), puis
 * applique la logique pure computeFunnel.
 */
export async function funnelReport(f: Filters, steps: string[]): Promise<FunnelStep[]> {
  if (!steps.length) return [];
  const itv = PERIODS[f.period].interval;
  const seg = buildSegment(f.segment, 4);
  const rows = await q<{ session_id: string; ord: number; t: number }>(
    `with steps as (
       select name, ord from unnest($3::text[]) with ordinality as s(name, ord)
     ),
     fe as (
       select e.session_id, st.ord, extract(epoch from min(e.ts)) as t
       from rum_event e
       join rum_session s on s.session_id = e.session_id
       join steps st on st.name = e.name
       where e.ts > now() - interval '${itv}'
         and ($1::text is null or e.app_id = $1)
         and ($2::text is null or s.device_type = $2)${seg.where("s")}${botClause(f, "s")}
       group by e.session_id, st.ord
     )
     select session_id, ord::int as ord, t::float8 as t
     from fe
     where session_id in (select session_id from fe where ord = 1)`,
    [f.app, f.device, steps, ...seg.params],
  );

  // Assemble par session : tableau des 1res dates indexé par étape (null si absente).
  const bySession = new Map<string, (number | null)[]>();
  for (const r of rows) {
    let arr = bySession.get(r.session_id);
    if (!arr) bySession.set(r.session_id, (arr = new Array(steps.length).fill(null)));
    arr[r.ord - 1] = r.t;
  }
  return computeFunnel([...bySession.values()], steps);
}
