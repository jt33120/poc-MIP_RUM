// Signaux de frustration (P1) — lecture console. Rage/dead clicks stockés dans
// rum_event ('frustration.<kind>') ; attribution INP (élément lent) dans
// rum_metric.attribution. Convention : $1 = app (null = toutes), $2 = device ;
// l'intervalle vient de PERIODS (constantes). Fail-soft (vide si la base bronche).
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";

export interface FrustrationRow {
  route: string;
  kind: "rage" | "dead" | "error";
  target: string;
  n: number;
}

/** Top des signaux de frustration (rage + dead + error clicks), groupés par route/cible. */
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
       where e.name in ('frustration.rage', 'frustration.dead', 'frustration.error')
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

export interface ScriptBloquant {
  /** URL du script, déjà nettoyée de sa query string à la collecte. */
  url: string;
  /** Nom de fonction, ou ce qui a invoqué le script quand la fonction est minifiée. */
  quoi: string;
  n: number;
  /** Somme du temps de blocage attribué, en millisecondes. */
  totalMs: number;
  /** La pire frame observée. */
  worstMs: number;
}

/**
 * Les scripts qui bloquent le fil principal, classés par temps de blocage CUMULÉ.
 *
 * POURQUOI LE CUMUL ET NON LE PIRE CAS. Un script qui bloque 400 ms une fois est
 * un incident ; un script qui bloque 60 ms à chaque frappe au clavier est le
 * problème. Classer par maximum remonte le premier et enterre le second, alors
 * que c'est le second qui décide de l'INP. Le pire cas reste affiché à côté —
 * il dit s'il faut chercher une opération unique ou une répétition.
 *
 * `blocking_ms` de préférence à `duration_ms` : la durée compte tout le cycle de
 * rendu, y compris la part que le navigateur aurait passée à peindre de toute
 * façon. Le blocage est la part que l'utilisateur SUBIT. Repli sur la durée pour
 * les navigateurs qui ne renseignent pas le champ.
 *
 * Ne rend QUE des lignes attribuées (`script_url is not null`) : une entrée
 * Long Tasks n'a pas de script, et l'afficher sous « (inconnu) » ferait une
 * première ligne écrasante qui n'apprend rien.
 */
export async function scriptsBloquants(f: Filters): Promise<ScriptBloquant[]> {
  const itv = PERIODS[f.period].interval;
  try {
    return await q<ScriptBloquant>(
      `select l.script_url as url,
              coalesce(nullif(l.script_function, ''), nullif(l.invoker, ''), '(anonyme)') as quoi,
              count(*)::int as n,
              round(sum(coalesce(l.blocking_ms, l.duration_ms))::numeric)::float as "totalMs",
              round(max(coalesce(l.blocking_ms, l.duration_ms))::numeric)::float as "worstMs"
       from rum_longtask l
       left join rum_session s using (session_id)
       where l.script_url is not null
         and l.ts > now() - interval '${itv}'
         and ($1::text is null or l.app_id = $1)
         and ($2::text is null or s.device_type = $2)
       group by 1, 2
       order by "totalMs" desc
       limit 20`,
      [f.app, f.device],
    );
  } catch {
    return [];
  }
}
