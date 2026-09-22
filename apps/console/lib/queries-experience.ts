// Couche de données de l'écran « Satisfaction » (`/experience`). Les feedbacks
// arrivent par le canal d'événements custom : rum_event(name='feedback',
// props={score:1..5, comment}). Aucune table ni ingestion spécifique. Aucun score
// composite n'est calculé (§ 5.5.1) : CSAT, LCP p75 et frustration sont lus à part,
// chacun avec sa source. Chaque lecture applique le contrat commun (plage,
// périmètre, route, session, bots).
import { q } from "./db";
import { partPositive } from "./experience";
import { type FiltersLike } from "./filters";
import { plageLue, surGrille } from "./queries";
import { MOBILE_RUNTIME, mobileSchema } from "./queries-mobile";
import { bucketExpr, sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";

export interface FeedbackStats {
  count: number;
  positives: number; // score >= 4
  avg: number | null;
  promoters: number; // 5
  passives: number; // 3–4
  detractors: number; // 1–2
}

/**
 * Agrégats des feedbacks sur la plage (score dans props->>'score').
 *
 * `shift` (F26, `cmp=prev`) : les mêmes agrégats sur la période précédente contiguë
 * (`previousRange`), même patron que `engagementStats(f, shift)` — pour les écarts
 * des tuiles CSAT, avis reçus et part de détracteurs.
 */
export async function feedbackStats(f: FiltersLike, shift = false): Promise<FeedbackStats> {
  const sql = await sqlContext(f);
  const range = plageLue(sql.query.range, shift);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts", range });
  const [r] = await q<FeedbackStats>(
    `with fb as (
       select (nullif(e.props->>'score',''))::int as score
       from rum_event e
       ${sessionJoin("e", "s")}
       where e.name = 'feedback'${where}
     )
     select
       count(*) filter (where score is not null)::int as count,
       count(*) filter (where score >= 4)::int as positives,
       avg(score)::float8 as avg,
       count(*) filter (where score >= 5)::int as promoters,
       count(*) filter (where score between 3 and 4)::int as passives,
       count(*) filter (where score between 1 and 2)::int as detractors
     from fb`,
    sql.params,
  );
  return (
    r ?? { count: 0, positives: 0, avg: null, promoters: 0, passives: 0, detractors: 0 }
  );
}

export interface ExperienceContext {
  lcp_p75: number | null;
  sessions: number;
  frustration: number; // rage + dead clicks
}

/**
 * Contexte perf/frustration affiché à côté du CSAT (LCP p75, sessions, clics rageurs et morts).
 *
 * `sessions` (commencées) et `frustration` (signaux datés par `e.ts`, toutes sessions)
 * ne sont PAS les deux termes d'un même taux : deux populations. L'écran n'en lit
 * que `lcp_p75` ; le taux « pour 1 000 sessions » vient de
 * `frustrationSessionsCommencees` (F26, revue).
 */
export async function experienceContext(f: FiltersLike): Promise<ExperienceContext> {
  const sql = await sqlContext(f);
  const vitals = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const sessions = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at" });
  const frustration = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  const [r] = await q<ExperienceContext>(
    `select
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m
          ${sessionJoin("m", "s")}
          where m.name = 'LCP'${vitals}
       )::float8 as lcp_p75,
       (select count(*)::int from rum_session s where true${sessions}) as sessions,
       (select count(*)::int from rum_event e
          ${sessionJoin("e", "s")}
          where e.name in ('frustration.rage','frustration.dead')${frustration}
       ) as frustration`,
    sql.params,
  );
  return r ?? { lcp_p75: null, sessions: 0, frustration: 0 };
}

export interface FrustrationSessionsCommencees {
  /** Sessions commencées dans `[from, to)` sous les filtres de l'écran. */
  sessions: number;
  /** Parmi elles, celles dont le capteur émet des signaux de frustration (runtime autre que React Native, ou inconnu). */
  sessionsCouvertes: number;
  /** Clics rageurs et morts portés par les sessions COUVERTES, quelle que soit leur date. */
  signaux: number;
  /** `false` : colonne `rum_session.runtime` absente (avant v82) — aucune session n'a pu être écartée. */
  runtimeLu: boolean;
}

/**
 * « Frustration pour 1 000 sessions » (F26, revue) : numérateur et dénominateur sur
 * LA MÊME population, même patron que `erreursParSessionCommencee` (B39).
 *
 * Le taux d'avant divisait des signaux datés par `e.ts` — de TOUTES les sessions,
 * y compris une session ouverte avant la fenêtre qui s'acharne dedans — par les
 * sessions COMMENCÉES : sous `period=1h`, douze clics d'une session de la veille
 * donnaient « 4 000 ». Ici :
 *   - dénominateur : les sessions commencées (`started_at ∈ [from, to)`), restreintes
 *     à celles dont le capteur émet (R-F, CP16) — le SDK React Native n'émet aucun
 *     signal de frustration : les compter ferait lire « personne ne s'acharne » là
 *     où personne n'écoute ;
 *   - numérateur : les signaux `frustration.rage` / `frustration.dead` joints à CES
 *     sessions par `(app_id, session_id)`, y compris ceux d'après `to` pour une
 *     session à cheval sur la borne (ils appartiennent à la session comptée).
 * Sans la colonne `runtime`, rien n'est écarté ; l'écran le dit (`partiel`).
 */
export async function frustrationSessionsCommencees(f: FiltersLike): Promise<FrustrationSessionsCommencees> {
  const runtimeLu = (await mobileSchema()).runtime;
  const sql = await sqlContext(f);
  const commencees = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at" });
  // Liée seulement si elle sert : un paramètre sans `$n` fait refuser l'instruction.
  const couverte = runtimeLu ? `(s.runtime is null or s.runtime <> ${sql.bind(MOBILE_RUNTIME)})` : "true";
  const [row] = await q<{ sessions: number; sessions_couvertes: number; signaux: number }>(
    `with commencees as (
       select s.app_id, s.session_id, ${couverte} as couverte
         from rum_session s
        where true${commencees}
     )
     select (select count(*) from commencees)::int as sessions,
            (select count(*) from commencees where couverte)::int as sessions_couvertes,
            (select count(*)
               from rum_event e
               join commencees c on c.app_id = e.app_id and c.session_id = e.session_id
              where c.couverte and e.name in ('frustration.rage', 'frustration.dead'))::int as signaux`,
    sql.params,
  );
  return {
    sessions: row?.sessions ?? 0,
    sessionsCouvertes: row?.sessions_couvertes ?? 0,
    signaux: row?.signaux ?? 0,
    runtimeLu,
  };
}

export interface FeedbackTrendRow {
  bucket: string;
  count: number;
  positives: number;
}

/**
 * Tendance du CSAT dans le temps (seaux journaliers alignés UTC, max 30 points).
 * Au-delà de 30 seaux, ce sont les 30 PLUS RÉCENTS qui restent : un `limit 30`
 * sur l'ordre croissant gardait les premiers jours et coupait la fin de la courbe.
 */
export async function feedbackTrend(f: FiltersLike): Promise<FeedbackTrendRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  const jour = bucketExpr("e.ts", { ...sql.query.range, bucketSeconds: 86_400 });
  return q<FeedbackTrendRow>(
    `select * from (
       select ${jour} as bucket,
              count(*) filter (where (nullif(e.props->>'score',''))::int is not null)::int as count,
              count(*) filter (where (nullif(e.props->>'score',''))::int >= 4)::int as positives
       from rum_event e
       ${sessionJoin("e", "s")}
       where e.name = 'feedback'${where}
       group by 1 order by 1 desc limit 30
     ) derniers order by bucket`,
    sql.params,
  );
}

export interface FeedbackTrendContratPoint {
  /** Début du seau du contrat, ISO UTC. */
  bucket: string;
  /** Part d'avis ≥ 4/5 du seau ; `null` sans avis noté (un trou, jamais « 0 % »). */
  csat: number | null;
  /** Avis NOTÉS du seau (un compte : 0 quand il n'y en a pas). */
  avis: number;
}

/**
 * CSAT et volume d'avis sur les SEAUX DU CONTRAT (F26, CP10) : `feedbackTrend`
 * impose des seaux journaliers, si bien que sous `1h` ou `24h` la courbe n'avait
 * qu'un point. Un point par seau de la grille (`bucketStarts`) : sans avis noté, le
 * CSAT est `null` et le volume 0 — la figure dessine un trou, pas une chute.
 */
export async function feedbackTrendContrat(f: FiltersLike): Promise<FeedbackTrendContratPoint[]> {
  const sql = await sqlContext(f);
  const range = sql.query.range;
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  const rows = await q<{ bucket: Date; avis: number; positifs: number }>(
    `with fb as (
       select ${bucketExpr("e.ts", range)} as bucket,
              (nullif(e.props->>'score',''))::int as score
         from rum_event e
         ${sessionJoin("e", "s")}
        where e.name = 'feedback'${where}
     )
     select bucket,
            count(*) filter (where score is not null)::int as avis,
            count(*) filter (where score >= 4)::int as positifs
       from fb
      group by 1 order by 1`,
    sql.params,
  );
  return surGrille<(typeof rows)[number], FeedbackTrendContratPoint>(
    rows,
    range,
    (r, t) => ({ bucket: t, csat: partPositive(r.positifs, r.avis), avis: r.avis }),
    (t) => ({ bucket: t, csat: null, avis: 0 }),
  );
}

export interface FeedbackRow {
  id: number;
  ts: string;
  score: number | null;
  comment: string | null;
  route: string | null;
  session_id: string | null;
}

/** Derniers verbatims (commentaire déjà scrubbé PII à l'ingestion). */
export async function recentFeedback(f: FiltersLike, limit = 30): Promise<FeedbackRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  return q<FeedbackRow>(
    `select e.id::int as id, e.ts,
            (nullif(e.props->>'score',''))::int as score,
            nullif(e.props->>'comment','') as comment,
            e.route, e.session_id
     from rum_event e
     ${sessionJoin("e", "s")}
     where e.name = 'feedback'${where}
     order by e.ts desc limit ${sql.bind(limit)}`,
    sql.params,
  );
}

export interface RouteCsatRow {
  route: string | null;
  count: number;
  positives: number;
  /** Notes 1-2 (F26) : la part de détracteurs d'une page = `detracteurs / count`. */
  detracteurs: number;
  /** Note moyenne : lue, plus affichée (une moyenne d'échelle ordinale 1-5, § 5.5.3). */
  avg: number | null;
  /** Pages ayant reçu un avis sur la fenêtre, AVANT la limite de 20 (troncature dite). */
  pages: number;
}

/** CSAT par route — pour relier satisfaction et parcours (top 20 par volume). */
export async function feedbackByRoute(f: FiltersLike): Promise<RouteCsatRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  return q<RouteCsatRow>(
    // `count` ne compte que les avis NOTÉS, comme feedbackStats. Un avis peut
    // n'avoir qu'un commentaire (score null, cf. mip-rum-feedback.js) : le
    // compter ici diluerait le ratio positives/count d'une route — une route à
    // commentaire seul rend `count = 0`, et l'écran en fait `null`, jamais 0 % (CP11).
    `select e.route,
            count(*) filter (where (nullif(e.props->>'score',''))::int is not null)::int as count,
            count(*) filter (where (nullif(e.props->>'score',''))::int >= 4)::int as positives,
            count(*) filter (where (nullif(e.props->>'score',''))::int <= 2)::int as detracteurs,
            avg((nullif(e.props->>'score',''))::int)::float8 as avg,
            count(*) over ()::int as pages
     from rum_event e
     ${sessionJoin("e", "s")}
     where e.name = 'feedback'${where}
     group by e.route order by count(*) desc, e.route asc nulls last limit 20`,
    sql.params,
  );
}
