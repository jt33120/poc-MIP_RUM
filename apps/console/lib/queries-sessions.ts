// Mesures d'engagement et tendance des visiteurs (P6.3) — couche I/O.
// Définitions, seuils et libellés : lib/engagement.ts, où ils sont testés.
//
// Une lecture en échec LÈVE (F02) : elle rendait autrefois des zéros, « 0 session
// commencée » pendant une panne. L'écran l'enveloppe dans `lire()` (lib/lecture.ts).
import { q } from "./db";
import { ENGAGEMENT_VIDE, STILL_ACTIVE_MINUTES, type EngagementStats } from "./engagement";
import type { FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql } from "./query-compiler";
import { sqlContext } from "./query-sql";

/**
 * Durée observée et sessions à une seule vue, sur les sessions COMMENCÉES dans la
 * fenêtre.
 *
 * La fenêtre porte donc sur `started_at`, et non sur `last_seen_at` comme la
 * liste : une session ouverte la veille et revue aujourd'hui apporterait sa durée
 * d'hier à la mesure du jour. `page_count` est maintenu par l'ingestion à partir
 * du compte RÉEL de pages vues de la session (app-scopé), ce qui rend le taux
 * indépendant de la fenêtre — d'où le décompte des sessions encore actives, dont
 * la durée et le nombre de vues peuvent encore bouger.
 */
export async function engagementStats(f: FiltersLike): Promise<EngagementStats> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at" });
  const fin = sql.bind(sql.query.range.to);
  const [row] = await q<EngagementStats>(
    `with commencees as (
       select s.page_count,
              greatest(0, extract(epoch from (s.last_seen_at - s.started_at))) as duree_observee,
              s.last_seen_at >= ${fin}::timestamptz - interval '${STILL_ACTIVE_MINUTES} minutes' as encore_active
         from rum_session s
        where true${where}
     )
     select count(*)::int as sessions_started,
            count(*) filter (where page_count >= 1)::int as sessions_with_view,
            count(*) filter (where page_count = 1)::int as single_view_sessions,
            count(*) filter (where encore_active)::int as still_active,
            percentile_cont(0.5) within group (order by duree_observee)
              filter (where page_count >= 1) as duration_p50_s,
            percentile_cont(0.75) within group (order by duree_observee)
              filter (where page_count >= 1) as duration_p75_s
       from commencees`,
    sql.params,
  );
  return row ?? ENGAGEMENT_VIDE;
}

export interface VisitorsBucket {
  bucket: Date;
  /** Visiteurs DISTINCTS observés dans le seau : non additionnable d'un seau à l'autre. */
  visitors: number;
  /** Sessions commencées dans le seau, elles additionnables. */
  sessions: number;
  /** Sessions sans identifiant de visiteur : hors du compte des visiteurs. */
  sans_identifiant: number;
}

/**
 * Tendance des VISITEURS OBSERVÉS : identifiants de visiteur distincts par seau.
 *
 * Un visiteur présent dans trois seaux est compté dans les trois : la somme des
 * seaux N'EST PAS le nombre de visiteurs de la fenêtre, et l'écran ne l'affiche
 * nulle part. Les sessions sans identifiant — historique antérieur au 09/09/2026,
 * SDK pas à jour — sont comptées à part plutôt que réparties au jugé.
 */
export async function observedVisitorsTrend(f: FiltersLike): Promise<VisitorsBucket[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at" });
  const serie = bucketSeriesSql(sql.query.range, sql.bind);
  return await q<VisitorsBucket>(
    `with agrege as (
       select ${bucketExpr("s.started_at", sql.query.range)} as bucket,
              count(distinct s.visitor_id)::int as visitors,
              count(*)::int as sessions,
              count(*) filter (where s.visitor_id is null)::int as sans_identifiant
         from rum_session s
        where true${where}
        group by 1
     )
     select b.bucket,
            coalesce(a.visitors, 0) as visitors,
            coalesce(a.sessions, 0) as sessions,
            coalesce(a.sans_identifiant, 0) as sans_identifiant
       from ${serie} as b(bucket)
       left join agrege a on a.bucket = b.bucket
      order by 1`,
    sql.params,
  );
}
