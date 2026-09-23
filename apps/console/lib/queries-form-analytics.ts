// Form Analytics — couche I/O (Lot 7b ; sur le contrat depuis B31, plan § 6.3).
// Lit les événements rum_event `form.submit` / `form.abandon` (émis par le SDK,
// Lot 7a) et les rend au format FormEvent pour l'agrégation pure
// (lib/form-analytics). Plafond de sécurité sur le volume rapatrié.
//
// B31 : fenêtre `[from, to)`, apps EFFECTIVES du principal, conditions et bots
// compilés par `sqlContext(f)` — plus de fenêtre glissante lue à l'heure du
// serveur, plus de filtre « app demandée, ou toutes si elle est nulle ». Jointure de session app-scopée.
// `ts` et `session_id` ne sont toujours pas renvoyés : c'est B34 (hors B31).
import { q } from "./db";
import type { FiltersLike } from "./filters";
import type { FormEvent, FormEventProps } from "./form-analytics";
import { sessionJoin } from "./query-compiler";
import { previousRange } from "./query-contract";
import { sqlContext } from "./query-sql";

/**
 * Événements de formulaire sur la fenêtre (submit + abandon), filtrés, les plus
 * récents d'abord, au plus `limit`. `shift` : la même lecture sur la période
 * précédente contiguë (`cmp=prev`).
 */
export async function formEvents(f: FiltersLike, limit = 5000, shift = false): Promise<FormEvent[]> {
  const sql = await sqlContext(f);
  const where = sql.where({
    dataset: "custom_events",
    row: "e",
    session: "s",
    time: "e.ts",
    ...(shift ? { range: previousRange(sql.query.range) } : {}),
  });
  const limite = sql.bind(limit);
  const rows = await q<{ name: string; props: FormEventProps | null }>(
    `select e.name, e.props
       from rum_event e
       ${sessionJoin("e", "s")}
      where e.name in ('form.submit', 'form.abandon')${where}
      order by e.ts desc, e.id desc
      limit ${limite}`,
    sql.params,
  );
  return rows.map((r) => ({ name: r.name, props: r.props ?? {} }));
}
