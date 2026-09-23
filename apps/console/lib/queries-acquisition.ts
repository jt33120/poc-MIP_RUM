// Acquisition — couche I/O (Lot 8a ; sur le contrat depuis B31, plan § 6.3).
// Récupère l'ENTRÉE de chaque session (référent, URL et route de la 1re page vue
// de la fenêtre) et délègue la classification et l'agrégation à la logique pure
// (lib/acquisition). Plafond de sécurité sur le nombre de sessions rapatriées.
//
// B31. La lecture d'avant filtrait l'app par « app demandée, ou toutes si elle est
// nulle » et lisait une fenêtre glissante à l'heure du serveur : sous `app=all`,
// elle laissait passer toutes les apps de la base (la console lit en BYPASSRLS),
// et ni la plage personnalisée, ni la tablette, ni « Inconnu » ne s'appliquaient. Elle passe par `sqlContext(f)` :
// fenêtre `[from, to)`, apps EFFECTIVES du principal, conditions et bots compilés
// par le contrat. Une session est désignée par `(app_id, session_id)` (identifiant
// émis par le client) ; une vue sans session n'est l'entrée de personne.
import { q } from "./db";
import {
  acquisitionReport,
  serieCanaux,
  PLAFOND_ACQUISITION,
  type AcquisitionReport,
  type PointCanaux,
} from "./acquisition";
import type { FiltersLike } from "./filters";
import { bucketExpr, sessionJoin } from "./query-compiler";
import { bucketStarts, previousRange, type ResolvedRange } from "./query-contract";
import { sqlContext } from "./query-sql";

interface EntreeLue {
  referrer: string | null;
  url: string | null;
  route: string | null;
  /** Début du seau de la 1re vue, en ms epoch (grille UTC du contrat). */
  t: number;
}

/**
 * Entrées de session sur une plage : la 1re vue de chaque session dans `[from, to)`,
 * au plus `cap` sessions, les PREMIÈRES par identifiant (pas les plus récentes).
 * Un contexte SQL par lecture : ses paramètres liés ne servent qu'à elle.
 */
async function entreesDeSession(f: FiltersLike, cap: number, shift: boolean): Promise<{ rows: EntreeLue[]; range: ResolvedRange }> {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error("plafond d'acquisition invalide");
  const sql = await sqlContext(f);
  const range = shift ? previousRange(sql.query.range) : sql.query.range;
  const where = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at", range });
  const limite = sql.bind(cap);
  const rows = await q<EntreeLue>(
    `select distinct on (p.app_id, p.session_id)
            p.referrer, p.url, p.route,
            (extract(epoch from ${bucketExpr("p.started_at", range)}) * 1000)::float8 as t
       from rum_pageview p
       ${sessionJoin("p", "s")}
      where p.session_id is not null${where}
      order by p.app_id, p.session_id, p.started_at asc, p.id asc
      limit ${limite}`,
    sql.params,
  );
  return { rows, range };
}

/**
 * Report d'acquisition (canaux, top référents, routes d'entrée par canal) sur la
 * fenêtre du contrat. `shift` (`cmp=prev`) : la même lecture sur la période
 * précédente contiguë (`previousRange`), même patron que `sessionsAvecVue(f, shift)`.
 */
export async function acquisition(f: FiltersLike, cap = PLAFOND_ACQUISITION, shift = false): Promise<AcquisitionReport> {
  const { rows } = await entreesDeSession(f, cap, shift);
  return acquisitionReport(rows);
}

/**
 * Canaux dans le temps (B31, A6) : les MÊMES sessions que `acquisition` (même
 * plafond, même ordre), chacune dans le seau de sa 1re vue, sur la grille du contrat
 * (`bucketStarts`), zéros compris. La somme de la série vaut donc `acquisition(f).total`.
 */
export async function acquisitionSerie(f: FiltersLike, cap = PLAFOND_ACQUISITION): Promise<PointCanaux[]> {
  const { rows, range } = await entreesDeSession(f, cap, false);
  return serieCanaux(rows, bucketStarts(range)).points;
}
