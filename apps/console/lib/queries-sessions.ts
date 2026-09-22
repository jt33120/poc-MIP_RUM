// Mesures d'engagement et tendance des visiteurs (P6.3) — couche I/O.
// Définitions, seuils et libellés : lib/engagement.ts, où ils sont testés.
//
// Une lecture en échec LÈVE (F02) : elle rendait autrefois des zéros, « 0 session
// commencée » pendant une panne. L'écran l'enveloppe dans `lire()` (lib/lecture.ts).
import { q } from "./db";
import { DEBUT_SAMPLE_RATE, type EchantillonnageSessions } from "./echantillonnage";
import { ENGAGEMENT_VIDE, STILL_ACTIVE_MINUTES, type EngagementStats } from "./engagement";
import { PERIODS, queryOf, type Filters, type FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql, sessionJoin } from "./query-compiler";
import { previousRange } from "./query-contract";
import { sqlContext } from "./query-sql";
import { buildSegment } from "./segments";

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
 *
 * `shift` (F10, `cmp=prev`) : la même mesure sur la période précédente contiguë
 * (`previousRange`), même patron que `overviewStats(f, shift)`. La borne des
 * sessions « encore actives » suit la plage LUE : sur la période précédente, c'est
 * sa propre fin, pas celle de la fenêtre courante.
 */
export async function engagementStats(f: FiltersLike, shift = false): Promise<EngagementStats> {
  const sql = await sqlContext(f);
  const range = shift ? previousRange(sql.query.range) : sql.query.range;
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at", range });
  const fin = sql.bind(range.to);
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

// ═══════════════ Échantillonnage de la population lue (B38, F40) ═══════════════
//
// Probabilité d'inclusion d'une session (migration-v58.sql, biaisée-erreurs) :
// `sample_rate + (1 − sample_rate) × error_sample_rate` si elle porte une erreur,
// `sample_rate` sinon. Aucune de ces lectures ne pondère quoi que ce soit (V4) :
// elles disent seulement si l'écran lit un échantillon (règle S7).

/**
 * Agrégat commun : minimum de la probabilité d'inclusion et sessions sans taux
 * enregistré, sur des lignes `rum_session` d'alias `s`. Exporté pour
 * `samplingVitals` (F10) : une seule formule biaisée-erreurs dans la console.
 */
export function agregatEchantillonnage(debut: string): string {
  return `count(*)::int as sessions,
          min(case when s.has_error then s.sample_rate + (1 - s.sample_rate) * s.error_sample_rate
                   else s.sample_rate end)::float8 as proba_min,
          count(*) filter (where s.started_at < ${debut}::timestamptz)::int as sans_taux,
          coalesce(bool_or(s.sample_rate < 1 and s.error_sample_rate > 0), false) as biaise_erreurs`;
}

export interface LigneEchantillonnage {
  sessions: number;
  proba_min: number | null;
  sans_taux: number;
  biaise_erreurs: boolean;
}

export function echantillonnageDe(row: LigneEchantillonnage | undefined): EchantillonnageSessions {
  return {
    probaMin: row?.proba_min ?? null,
    sessions: row?.sessions ?? 0,
    sansTaux: row?.sans_taux ?? 0,
    biaiseErreurs: row?.biaise_erreurs ?? false,
  };
}

/**
 * Échantillonnage de la population d'un écran SUR LE CONTRAT (`/sessions`, `/map`).
 *
 * Sans option : sessions COMMENCÉES ou ACTIVES dans `[from, to)` — l'union des deux
 * populations de `/sessions` (tuiles sur `started_at`, liste et anneau sur
 * `last_seen_at`) : le minimum de l'union borne chacune. Le prédicat de temps est
 * écrit ici (un `or` de deux fenêtres, bornes liées) ; le reste — périmètre d'apps,
 * conditions, bots — est compilé par le contrat, SANS fenêtre (`time: null`).
 *
 * `avecSpans` (`/map`) : sessions portant au moins un span FRONT dans `[from, to)`,
 * filtré comme les lectures de la carte (jeu `spans`). Une session « biaisée-erreurs »
 * sans erreur n'émet aucun span : elle n'est pas dans cette population.
 */
export async function samplingSessions(
  f: FiltersLike,
  opts: { avecSpans?: boolean } = {},
): Promise<EchantillonnageSessions> {
  const sql = await sqlContext(f);
  const debut = sql.bind(DEBUT_SAMPLE_RATE);
  if (opts.avecSpans) {
    const where = sql.where({ dataset: "spans", row: "sp", session: "s", time: "sp.ts" });
    const [row] = await q<LigneEchantillonnage>(
      `with population as (
         select distinct sp.app_id, sp.session_id
           from rum_span sp
           ${sessionJoin("sp", "s")}
          where sp.tier = 'front' and sp.session_id is not null${where}
       )
       select ${agregatEchantillonnage(debut)}
         from population p
         join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id`,
      sql.params,
    );
    return echantillonnageDe(row);
  }
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: null });
  const de = sql.bind(sql.query.range.from);
  const a = sql.bind(sql.query.range.to);
  const [row] = await q<LigneEchantillonnage>(
    `select ${agregatEchantillonnage(debut)}
       from rum_session s
      where ((s.started_at >= ${de}::timestamptz and s.started_at < ${a}::timestamptz)
          or (s.last_seen_at >= ${de}::timestamptz and s.last_seen_at < ${a}::timestamptz))${where}`,
    sql.params,
  );
  return echantillonnageDe(row);
}

/**
 * Population d'un écran d'usage HISTORIQUE (lecture `now() - intervalle`, non
 * migrée sur le contrat), pour que le bandeau qualifie EXACTEMENT ce que l'écran
 * lit (règle S2 : jamais une population du contrat sous une figure historique).
 */
export type PopulationHistorique =
  /** Sessions ayant une page vue sur `PERIODS[f.period]` : `/acquisition`, `/paths`. */
  | { lecture: "vues" }
  /** Sessions ayant émis `form.submit` / `form.abandon` sur `PERIODS[f.period]` : `/forms`. */
  | { lecture: "formulaires" }
  /** Sessions identifiées (`visitor_id`) commencées sur les `semaines` dernières semaines : `/retention`. */
  | { lecture: "cohortes"; semaines: number };

/**
 * Échantillonnage d'une population d'écran historique (`/acquisition`, `/paths`,
 * `/forms`, `/retention`) : mêmes prédicats que la lecture qu'il qualifie
 * (lib/queries-{acquisition,paths,form-analytics,cohorts}.ts) — fenêtre
 * `now() - intervalle`, appareil, segment v1, bots.
 *
 * Seule différence, voulue : le périmètre d'apps est lié par les apps EFFECTIVES
 * (`= any($1)`), jamais par `($1::text is null or app_id = $1)` (R-A, § 0.3). Sur
 * tout chemin que l'écran accepte, c'est la même population : app nommée → [app] ;
 * admin sous `app=all` → toutes les apps (null) ; principal restreint sous
 * `app=all` → l'écran est refusé avant toute lecture (`perimetreAvailability`).
 * Retiré par F53 quand ces écrans passeront sur le contrat (`samplingSessions`).
 *
 * Toute jointure à la session se fait sur `(app_id, session_id)`, comme
 * `samplingSessions` : `session_id` seul ne désigne pas une session, et une ligne
 * de A qui citerait l'identifiant d'une session de B ferait entrer B (et son taux)
 * dans la population de A.
 */
export async function samplingSessionsHistorique(
  f: Filters,
  population: PopulationHistorique,
): Promise<EchantillonnageSessions> {
  const apps = queryOf(f).scope.effectiveApps;
  const bots = f.includeBots ? "" : " and not coalesce(s.is_bot, false)";
  let pop: string;
  let params: unknown[];
  if (population.lecture === "cohortes") {
    const semaines = population.semaines;
    if (!Number.isSafeInteger(semaines) || semaines < 1 || semaines > 53) throw new Error("fenêtre de rétention invalide");
    const seg = buildSegment(f.segment, 4);
    pop = `select s.app_id, s.session_id
             from rum_session s
            where s.visitor_id is not null
              and s.started_at > now() - $3::int * interval '1 week'
              and ($1::text[] is null or s.app_id = any($1::text[]))
              and ($2::text is null or s.device_type = $2)${seg.where("s")}${bots}`;
    params = [apps, f.device, semaines, ...seg.params];
  } else {
    // Intervalle lu dans PERIODS (constantes de code), comme les lectures qualifiées.
    const itv = PERIODS[f.period].interval;
    const seg = buildSegment(f.segment, 3);
    pop =
      population.lecture === "vues"
        ? `select distinct p.app_id, p.session_id
             from rum_pageview p
             join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id
            where p.started_at > now() - interval '${itv}'
              and ($1::text[] is null or p.app_id = any($1::text[]))
              and ($2::text is null or s.device_type = $2)${seg.where("s")}${bots}`
        : `select distinct e.app_id, e.session_id
             from rum_event e
             join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id
            where e.ts > now() - interval '${itv}'
              and e.name in ('form.submit', 'form.abandon')
              and ($1::text[] is null or e.app_id = any($1::text[]))
              and ($2::text is null or s.device_type = $2)${seg.where("s")}${bots}`;
    params = [apps, f.device, ...seg.params];
  }
  const debut = `$${params.push(DEBUT_SAMPLE_RATE)}`;
  const [row] = await q<LigneEchantillonnage>(
    `with population as (${pop})
     select ${agregatEchantillonnage(debut)}
       from population p
       join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id`,
    params,
  );
  return echantillonnageDe(row);
}
