// Signaux de frustration (P1) — lecture console. Rage/dead clicks stockés dans
// rum_event ('frustration.<kind>') ; attribution INP (élément lent) dans
// rum_metric.attribution. Convention : $1 = app (null = toutes), $2 = device ;
// l'intervalle vient de PERIODS (constantes). Fail-soft (vide si la base bronche).
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";

export interface FrustrationRow {
  route: string;
  kind: "rage" | "dead";
  target: string;
  n: number;
}

/** Top des signaux de frustration (rage + dead), groupés par route/cible. */
export async function topFrustrations(f: Filters): Promise<FrustrationRow[]> {
  const itv = PERIODS[f.period].interval;
  try {
    return await q<FrustrationRow>(
      `select coalesce(e.route, '(inconnu)') as route,
              replace(e.name, 'frustration.', '') as kind,
              coalesce(e.props->>'target', '(inconnu)') as target,
              count(*)::int as n
       from rum_event e
       left join rum_session s using (session_id)
       where e.name in ('frustration.rage', 'frustration.dead')
         and e.ts > now() - interval '${itv}'
         and ($1::text is null or e.app_id = $1)
         and ($2::text is null or s.device_type = $2)
       group by 1, 2, 3
       order by n desc
       limit 50`,
      [f.app, f.device],
    );
  } catch {
    return [];
  }
}

export interface InpOffender {
  target: string;
  n: number;
  p75: number;
  worst: number;
}

/**
 * Éléments responsables des interactions lentes (attribution INP) : le sélecteur
 * `interactionTarget` de web-vitals, classé par p75 de la latence INP.
 */
export async function inpOffenders(f: Filters): Promise<InpOffender[]> {
  const itv = PERIODS[f.period].interval;
  try {
    return await q<InpOffender>(
      `select coalesce(m.attribution->>'interactionTarget', '(inconnu)') as target,
              count(*)::int as n,
              percentile_cont(0.75) within group (order by m.value) as p75,
              max(m.value) as worst
       from rum_metric m
       left join rum_session s using (session_id)
       where m.name = 'INP' and m.attribution is not null
         and m.ts > now() - interval '${itv}'
         and ($1::text is null or m.app_id = $1)
         and ($2::text is null or s.device_type = $2)
       group by 1
       order by p75 desc nulls last
       limit 20`,
      [f.app, f.device],
    );
  } catch {
    return [];
  }
}
