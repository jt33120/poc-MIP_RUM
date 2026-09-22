// Tâches longues et Long Animation Frames (P6.3) — couche I/O.
//
// DEUX API, JAMAIS ADDITIONNÉES. `rum_longtask.source` dit laquelle a parlé :
// Long Animation Frames sur Chromium, Long Tasks ailleurs. Le SDK n'en active
// qu'une à la fois, mais un parc mixte produit les deux ; la série les garde
// SÉPARÉES, car un même blocage observé par les deux compterait double.
//
// AUCUNE SOMME DE DURÉES N'EST PRÉSENTÉE COMME DU TEMPS UTILISATEUR. Des frames
// concurrentes de plusieurs onglets, de plusieurs sessions et de plusieurs
// visiteurs se chevauchent : leur somme n'est le temps perdu de personne. La vue
// compte des blocages et donne leur p75 et leur pire cas, jamais un cumul
// libellé « temps d'attente ».
//
// Une lecture en échec LÈVE (F02) : une série de zéros pendant une panne se
// lirait « aucun blocage ». L'écran l'enveloppe dans `lire()` (lib/lecture.ts).
import { q } from "./db";
import type { FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql, sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";

export interface LongtaskBucket {
  bucket: Date;
  /** Long Animation Frames (Chromium). */
  loaf: number;
  /** Long Tasks (API historique, autres navigateurs). */
  longtask: number;
  /** Lignes antérieures à la distinction (09/09/2026). */
  inconnu: number;
  /** p75 du blocage observé du seau, en millisecondes ; null sans mesure. */
  p75_ms: number | null;
}

/** Série des blocages par seau, zéros compris — un seau sans blocage vaut 0. */
export async function longtaskSeries(f: FiltersLike): Promise<LongtaskBucket[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "longtasks", row: "l", session: "s", time: "l.ts" });
  const serie = bucketSeriesSql(sql.query.range, sql.bind);
  return await q<LongtaskBucket>(
    `with agrege as (
       select ${bucketExpr("l.ts", sql.query.range)} as bucket,
              count(*) filter (where l.source = 'loaf')::int as loaf,
              count(*) filter (where l.source = 'longtask')::int as longtask,
              count(*) filter (where l.source is null)::int as inconnu,
              percentile_cont(0.75) within group (order by coalesce(l.blocking_ms, l.duration_ms)) as p75_ms
         from rum_longtask l
         ${sessionJoin("l", "s")}
        where true${where}
        group by 1
     )
     select b.bucket,
            coalesce(a.loaf, 0) as loaf,
            coalesce(a.longtask, 0) as longtask,
            coalesce(a.inconnu, 0) as inconnu,
            a.p75_ms
       from ${serie} as b(bucket)
       left join agrege a on a.bucket = b.bucket
      order by 1`,
    sql.params,
  );
}

export interface LongtaskWorst {
  /** Session d'origine ; null pour une ligne sans session rattachée. */
  session_id: string | null;
  route: string | null;
  /** Ce qui a bloqué : fonction, invocation, ou l'API qui a parlé. */
  quoi: string;
  source: string | null;
  blocking_ms: number;
  ts: Date;
}

export const LONGTASK_WORST_LIMIT = 10;

/**
 * Les blocages les plus longs, chacun avec sa session : le chemin entre « le fil
 * principal a été tenu 380 ms » et le parcours où c'est arrivé. Une ligne par
 * blocage, jamais un agrégat — c'est le cas individuel qu'on vient ouvrir.
 */
export async function worstLongtasks(f: FiltersLike, limit = LONGTASK_WORST_LIMIT): Promise<LongtaskWorst[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "longtasks", row: "l", session: "s", time: "l.ts" });
  return await q<LongtaskWorst>(
    `select s.session_id, l.route, l.source, l.ts,
            coalesce(nullif(l.script_function, ''), nullif(l.invoker, ''),
                     case when l.source = 'loaf' then 'frame longue (script non attribué)'
                          else 'tâche longue (sans attribution)' end) as quoi,
            coalesce(l.blocking_ms, l.duration_ms)::float8 as blocking_ms
       from rum_longtask l
       ${sessionJoin("l", "s")}
      where true${where}
      order by coalesce(l.blocking_ms, l.duration_ms) desc, l.id desc
      limit ${Number(limit)}`,
    sql.params,
  );
}
