// Lecture des percentiles PONDÉRÉS depuis les seaux pré-agrégés.
//
// POURQUOI CE FICHIER EXISTE. Le lot 3 a repondéré les volumes par la
// probabilité d'inclusion réelle de chaque session, mais a dû DÉCLARER les
// percentiles non corrigés : `percentile_cont` n'accepte pas de poids, et
// PostgreSQL n'a pas d'équivalent pondéré. Un p75 affiché sous échantillonnage
// biaisé par les erreurs portait donc sur un échantillon qui sur-représente les
// sessions lentes.
//
// Une somme cumulée sur des seaux n'a pas ce problème : le poids est DANS le
// seau. `percentileDepuisSeaux` lit la distribution, pas les lignes — et rend
// donc un percentile de la POPULATION.
//
// ─────────────────── LA PARTITION EXACTE, ET POURQUOI ELLE COMPTE ─────────────
//
// Le pré-agrégat est rafraîchi toutes les heures : le lire seul afficherait un
// p75 aveugle au trafic de la dernière heure — exactement celui qu'on regarde
// quand quelque chose vient de casser. On additionne donc deux sources :
//
//   pré-agrégé   les heures ENTIÈRES de la fenêtre, situées sous la borne du
//                dernier rafraîchissement (metric_histogram_state) ;
//   vif          tout le reste de la fenêtre — l'heure partielle du début, tout
//                ce qui est postérieur à cette borne, ET tout ce qui est ARRIVÉ
//                après elle, quel que soit son `ts`.
//
// La troisième condition n'est pas une précaution : sans elle il manquait des
// mesures, et le test d'intégration l'a montré. Une mesure rejouée par le SDK
// après une coupure porte un `ts` vieux de plusieurs heures et arrive dans une
// heure DÉJÀ agrégée ; elle n'est alors ni dans les seaux ni dans le calcul vif.
// L'identifiant de ligne (`rum_metric.id`, croissant à l'insertion) sépare les
// deux cas là où `ts` ne le peut pas.
//
// Les trois conditions partitionnent la fenêtre : une ligne d'une heure entière
// déjà agrégée porte un id sous la borne et un `ts` dans [hb, hw), donc elle
// échoue aux trois branches du « ou » et n'est comptée QUE par le pré-agrégat.
// Quand la table d'état est vide (base jamais rafraîchie), la borne de temps
// tombe en 1970 et celle d'identifiant à 0 : tout passe par le calcul vif, la
// valeur reste juste, seul le coût change.
import { q } from "./db";
import { percentileDepuisSeaux, type SeauPondere } from "./histogramme";

/** Une ligne de distribution : une métrique, un seau, le poids qu'il porte. */
interface LigneSeau extends SeauPondere {
  name: string;
}

const SQL = `
  with borne as (
    -- to_timestamp(0) et non now() : sans rafraîchissement connu, on recalcule
    -- tout plutôt que de supposer qu'un pré-agrégat inexistant est à jour.
    select coalesce((select refreshed_at from metric_histogram_state), to_timestamp(0)) as t,
           coalesce((select max_metric_id from metric_histogram_state), 0) as wid
  ),
  cadre as (
    -- hb = début de la première heure ENTIÈRE de la fenêtre ; hw = début de
    -- l'heure du dernier rafraîchissement. Les heures de [hb, hw) sont, et sont
    -- seules à être, entièrement pré-agrégées : hour >= hb parce qu'elles
    -- commencent après le début de la fenêtre, et hour + 1h <= hw <= t parce
    -- qu'elles se terminent avant la borne. Le reste est recalculé.
    select now() - $2::interval as debut,
           date_trunc('hour', now() - $2::interval) + interval '1 hour' as hb,
           date_trunc('hour', b.t) as hw,
           b.wid
      from borne b
  ),
  pre as (
    select h.name, h.bucket, sum(h.weighted_count) as w
      from metric_histogram_hourly h, cadre c
     where h.app_id = $1 and h.name = any($3::text[])
       and h.hour >= c.hb and h.hour < c.hw
     group by 1, 2
  ),
  vif as (
    select m.name, mip_seau(m.value) as bucket, sum(coalesce(s.weight, 1)) as w
      from rum_metric m
      left join rum_session s using (session_id), cadre c
     where m.app_id = $1 and m.name = any($3::text[])
       and m.ts >= c.debut and (m.ts < c.hb or m.ts >= c.hw or m.id > c.wid)
       and not coalesce(s.is_bot, false)
     group by 1, 2
  )
  select name, bucket, sum(w)::float8 as weighted_count
    from (select * from pre union all select * from vif) x
   group by 1, 2`;

/**
 * Percentiles pondérés de plusieurs métriques sur une fenêtre, en une requête.
 *
 * Rend `null` pour une métrique sans aucune mesure — et jamais 0, qui se lirait
 * comme un LCP parfait alors qu'il signifie « rien mesuré ».
 */
export async function percentilesPonderes(
  app: string,
  interval: string,
  noms: string[],
  p = 0.75,
): Promise<Record<string, number | null>> {
  const rows = await q<LigneSeau>(SQL, [app, interval, noms]);
  const parNom = new Map<string, SeauPondere[]>(noms.map((n) => [n, []]));
  for (const r of rows) {
    parNom.get(r.name)?.push({ bucket: Number(r.bucket), weighted_count: Number(r.weighted_count) });
  }
  const out: Record<string, number | null> = {};
  for (const nom of noms) out[nom] = percentileDepuisSeaux(parNom.get(nom) ?? [], p);
  return out;
}
