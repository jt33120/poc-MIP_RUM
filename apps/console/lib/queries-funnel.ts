// Entonnoir — couche I/O (Lot 6c ; sur le contrat depuis B31, plan § 6.3) sur
// rum_event. `availableEvents` liste les événements custom disponibles (pour
// construire un funnel) ; `funnelReport` calcule l'entonnoir pour une suite
// d'étapes ordonnée. Le SQL fournit la 1re date de chaque étape par session ;
// l'ordre et l'atteinte sont décidés par lib/funnel (définition de référence pure).
//
// Anti-injection : les noms d'étapes sont des VALEURS liées (`text[]`), jamais
// interpolés. Périmètre, fenêtre `[from, to)`, conditions et bots : `sqlContext(f)`,
// un contexte par instruction. Une session est désignée par `(app_id, session_id)`.
import { q } from "./db";
import type { FiltersLike } from "./filters";
import { computeFunnel, type FunnelStep } from "./funnel";
import { sessionJoin } from "./query-compiler";
import { previousRange } from "./query-contract";
import { sqlContext } from "./query-sql";

export interface EventOption {
  name: string;
  n: number;
  sessions: number;
}

/** Événements custom disponibles sur la fenêtre (pour le sélecteur d'étapes). */
export async function availableEvents(f: FiltersLike, limit = 50): Promise<EventOption[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  const limite = sql.bind(limit);
  return q<EventOption>(
    `select e.name,
            count(*)::int as n,
            count(distinct (e.app_id, e.session_id))::int as sessions
       from rum_event e
       ${sessionJoin("e", "s")}
      where e.session_id is not null${where}
      group by e.name
      order by count(distinct (e.app_id, e.session_id)) desc, e.name
      limit ${limite}`,
    sql.params,
  );
}

/**
 * Rapport d'entonnoir pour une suite d'étapes ORDONNÉE (>= 1). Récupère la 1re
 * date de chaque étape par session (sessions ayant réalisé l'étape 1), puis
 * applique la logique pure computeFunnel. `shift` : la même lecture sur la
 * période précédente contiguë.
 */
export async function funnelReport(f: FiltersLike, steps: string[], shift = false): Promise<FunnelStep[]> {
  if (!steps.length) return [];
  const sql = await sqlContext(f);
  const where = sql.where({
    dataset: "custom_events",
    row: "e",
    session: "s",
    time: "e.ts",
    ...(shift ? { range: previousRange(sql.query.range) } : {}),
  });
  const etapes = sql.bind(steps);
  const rows = await q<{ app_id: string; session_id: string; ord: number; t: number }>(
    `with steps as (
       select name, ord from unnest(${etapes}::text[]) with ordinality as st(name, ord)
     ),
     fe as (
       select e.app_id, e.session_id, st.ord, extract(epoch from min(e.ts)) as t
         from rum_event e
         ${sessionJoin("e", "s")}
         join steps st on st.name = e.name
        where e.session_id is not null${where}
        group by e.app_id, e.session_id, st.ord
     )
     select app_id, session_id, ord::int as ord, t::float8 as t
       from fe
      where (app_id, session_id) in (select app_id, session_id from fe where ord = 1)`,
    sql.params,
  );

  // Assemble par session : tableau des 1res dates indexé par étape (null si absente).
  const bySession = new Map<string, (number | null)[]>();
  for (const r of rows) {
    // Clé composée sans ambiguïté, quels que soient les caractères des identifiants.
    const cle = JSON.stringify([r.app_id, r.session_id]);
    let arr = bySession.get(cle);
    if (!arr) bySession.set(cle, (arr = new Array(steps.length).fill(null)));
    arr[r.ord - 1] = r.t;
  }
  return computeFunnel([...bySession.values()], steps);
}
