// Mesures d'engagement et tendance des visiteurs (P6.3) — couche I/O.
// Définitions, seuils et libellés : lib/engagement.ts, où ils sont testés.
//
// Une lecture en échec LÈVE (F02) : elle rendait autrefois des zéros, « 0 session
// commencée » pendant une panne. L'écran l'enveloppe dans `lire()` (lib/lecture.ts).
import { q } from "./db";
import { DEBUT_SAMPLE_RATE, type EchantillonnageSessions } from "./echantillonnage";
import { ENGAGEMENT_VIDE, STILL_ACTIVE_MINUTES, type EngagementStats } from "./engagement";
import type { FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql, sessionJoin } from "./query-compiler";
import { previousRange } from "./query-contract";
import { sqlContext, type SqlContext } from "./query-sql";
// F41 : tuiles et répartition lues par l'Explorer (une seule définition des mesures).
import { EXPLORER_VERSION, type ExplorerPlan } from "./analytics-schema";
import { exploreAnalytics } from "./queries-explorer";
import { MOBILE_RUNTIME } from "./queries-mobile";
import type { AnalyticsQuery, Dimension } from "./query-contract";

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
  bucket: Date | string;
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
 *
 * `shift` (F41, `cmp=prev`) : la même série sur la période précédente contiguë,
 * sur SES seaux (même largeur, même nombre). L'écran l'aligne par RANG de seau
 * sur la grille courante, jamais par instant (§ 3.2).
 */
export async function observedVisitorsTrend(f: FiltersLike, shift = false): Promise<VisitorsBucket[]> {
  const sql = await sqlContext(f);
  const range = shift ? previousRange(sql.query.range) : sql.query.range;
  const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at", range });
  const serie = bucketSeriesSql(range, sql.bind);
  return await q<VisitorsBucket>(
    `with agrege as (
       select ${bucketExpr("s.started_at", range)} as bucket,
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
 * Population d'un écran d'usage (`/acquisition`, `/paths`, `/forms`, `/retention`),
 * pour que le bandeau qualifie EXACTEMENT ce que l'écran lit (règle S7) : les
 * mêmes prédicats que la lecture qu'il qualifie, sur le contrat depuis B31.
 */
export type PopulationUsage =
  /** Sessions ayant une page vue dans `[from, to)` : `/acquisition`, `/paths`. */
  | { lecture: "vues" }
  /** Sessions ayant émis `form.submit` / `form.abandon` dans `[from, to)` : `/forms`. */
  | { lecture: "formulaires" }
  /** Sessions identifiées (`visitor_id`) commencées sur les `semaines` dernières semaines : `/retention`. */
  | { lecture: "cohortes"; semaines: number };

/**
 * Échantillonnage de la population d'un écran SUR LE CONTRAT.
 *
 * Sans option (`/sessions`) : sessions COMMENCÉES ou ACTIVES dans `[from, to)` —
 * l'union des deux populations de `/sessions` (tuiles sur `started_at`, liste et
 * anneau sur `last_seen_at`) : le minimum de l'union borne chacune. Le prédicat de
 * temps est écrit ici (un `or` de deux fenêtres, bornes liées) ; le reste —
 * périmètre d'apps, conditions, bots — est compilé par le contrat, SANS fenêtre
 * (`time: null`).
 *
 * `avecSpans` (`/map`) : sessions portant au moins un span FRONT dans `[from, to)`,
 * filtré comme les lectures de la carte (jeu `spans`). Une session « biaisée-erreurs »
 * sans erreur n'émet aucun span : elle n'est pas dans cette population.
 *
 * `population` (écrans d'usage, F53) : remplace `samplingSessionsHistorique`, qui
 * reproduisait la fenêtre glissante et le segment v1 des lectures d'avant B31. Les
 * cibles compilées sont celles des lectures qualifiées (lib/queries-{acquisition,
 * paths,form-analytics,cohorts}.ts) : `views` sur `p.started_at`, `custom_events` sur
 * `e.ts`, `sessions` sans fenêtre du contrat pour les N semaines de la rétention.
 *
 * Toute jointure à la session se fait sur `(app_id, session_id)` : `session_id` seul
 * ne désigne pas une session, et une ligne de A qui citerait l'identifiant d'une
 * session de B ferait entrer B (et son taux) dans la population de A.
 */
export async function samplingSessions(
  f: FiltersLike,
  opts: { avecSpans?: boolean; population?: PopulationUsage } = {},
): Promise<EchantillonnageSessions> {
  const sql = await sqlContext(f);
  const debut = sql.bind(DEBUT_SAMPLE_RATE);
  const population = opts.avecSpans ? populationSpans(sql) : opts.population ? populationUsage(sql, opts.population) : null;
  if (population) {
    const [row] = await q<LigneEchantillonnage>(
      `with population as (${population})
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

/** Sessions portant un span FRONT dans la fenêtre (`/map`). */
function populationSpans(sql: SqlContext): string {
  const where = sql.where({ dataset: "spans", row: "sp", session: "s", time: "sp.ts" });
  return `select distinct sp.app_id, sp.session_id
            from rum_span sp
            ${sessionJoin("sp", "s")}
           where sp.tier = 'front' and sp.session_id is not null${where}`;
}

/** La population d'un écran d'usage, `(app_id, session_id)` distincts. */
function populationUsage(sql: SqlContext, population: PopulationUsage): string {
  if (population.lecture === "cohortes") {
    const semaines = population.semaines;
    if (!Number.isSafeInteger(semaines) || semaines < 1 || semaines > 53) throw new Error("fenêtre de rétention invalide");
    const where = sql.where({ dataset: "sessions", row: "s", session: "s", time: null });
    return `select s.app_id, s.session_id
              from rum_session s
             where s.visitor_id is not null
               and s.started_at > now() - ${sql.bind(semaines)}::int * interval '1 week'${where}`;
  }
  if (population.lecture === "vues") {
    const where = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at" });
    return `select distinct p.app_id, p.session_id
              from rum_pageview p
              ${sessionJoin("p", "s")}
             where p.session_id is not null${where}`;
  }
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  return `select distinct e.app_id, e.session_id
            from rum_event e
            ${sessionJoin("e", "s")}
           where e.session_id is not null and e.name in ('form.submit', 'form.abandon')${where}`;
}

// ═══════════════ Rangée KPI et répartition de /sessions (F41) ═══════════════

/** Occurrences d'erreur des sessions commencées (B39), et celles qu'aucune session ne porte. */
export interface ErreursParSessionCommencee {
  /** Sessions commencées dans `[from, to)` : le dénominateur. */
  sessions: number;
  /** `sum(occurrences)` des erreurs RATTACHÉES à ces sessions, quelle que soit leur date (V1). */
  occurrences: number;
  /** `sum(occurrences)` des erreurs datées de `[from, to)` sans session rattachée : exclues, dites. */
  sansSession: number;
}

/**
 * Occurrences d'erreur par session commencée (B39, § 5.11.4) : numérateur et
 * dénominateur portent sur LA MÊME population.
 *
 * Le ratio d'avant, `overviewStats.errors / overviewStats.sessions`, divisait des
 * occurrences datées par `e.ts` — erreurs serveur sans session comprises — par des
 * sessions comptées sur leur DERNIÈRE activité : deux populations, un quotient qui
 * n'était le taux de rien. Ici, le dénominateur est la CTE de `engagementStats`
 * (sessions commencées, `started_at ∈ [from, to)`), et le numérateur somme les
 * occurrences des erreurs jointes à CES sessions par `(app_id, session_id)` — y
 * compris celles d'après `to` pour une session à cheval sur la borne : elles
 * appartiennent à la session comptée. Les erreurs sans session rattachée (Node,
 * Python, OTel, identifiant de session inconnu) ne peuvent entrer dans aucun des
 * deux termes : elles sont comptées à part, sur la fenêtre (`e.ts`), pour être
 * DITES à côté du chiffre.
 *
 * `shift` (`cmp=prev`) : la même lecture sur la période précédente contiguë.
 */
export async function erreursParSessionCommencee(f: FiltersLike, shift = false): Promise<ErreursParSessionCommencee> {
  const sql = await sqlContext(f);
  const range = shift ? previousRange(sql.query.range) : sql.query.range;
  const commencees = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.started_at", range });
  // Erreurs sans session : la jointure de session du compilateur (`sessionJoin`,
  // app-scopée) ne trouve personne. Les filtres de SESSION (appareil, navigateur…)
  // les écartent aussi : une erreur sans session n'a pas d'appareil, on ne la
  // range pas dans un segment qu'on ne peut pas lui attribuer.
  const orphelines = sql.where({ dataset: "errors", row: "e", session: "s", time: "e.ts", range });
  const [row] = await q<{ sessions: number; occurrences: number | null; sans_session: number | null }>(
    `with commencees as (
       select s.app_id, s.session_id
         from rum_session s
        where true${commencees}
     )
     select (select count(*) from commencees)::int as sessions,
            (select coalesce(sum(e.occurrences), 0)
               from rum_error e
               join commencees c on c.app_id = e.app_id and c.session_id = e.session_id)::float8 as occurrences,
            (select coalesce(sum(e.occurrences), 0)
               from rum_error e
               ${sessionJoin("e", "s")}
              where s.session_id is null${orphelines})::float8 as sans_session`,
    sql.params,
  );
  return {
    sessions: row?.sessions ?? 0,
    occurrences: Number(row?.occurrences ?? 0),
    sansSession: Number(row?.sans_session ?? 0),
  };
}

/**
 * Plans Explorer de l'écran : les tuiles et la répartition lisent la MÊME définition
 * que l'Explorer (garde « identifiant aléatoire » des visiteurs, population des
 * sessions commencées), et leur lien « Ouvrir dans l'Explorer » rejoue ce plan-là.
 */
export const PLAN_VISITEURS_DISTINCTS: ExplorerPlan = {
  version: EXPLORER_VERSION,
  dataset: "sessions",
  measure: { field: "visitors", aggregation: "distinct" },
  variant: null,
  groupBy: [],
  visualization: "value",
  limit: 10,
  cursor: null,
};

export const PLAN_SESSIONS_COMMENCEES: ExplorerPlan = {
  ...PLAN_VISITEURS_DISTINCTS,
  measure: { field: "started", aggregation: "count" },
  visualization: "timeseries",
};

/** Au plus 12 groupes dans « Qui sont ces sessions » (§ 5.11.4). */
export const REPARTITION_LIMITE = 12;

export function planRepartition(dimension: Dimension): ExplorerPlan {
  return {
    ...PLAN_VISITEURS_DISTINCTS,
    measure: { field: "started", aggregation: "count" },
    groupBy: [dimension],
    visualization: "toplist",
    limit: REPARTITION_LIMITE,
  };
}

/** La requête de l'écran, décalée sur la période précédente contiguë (`cmp=prev`). */
function periodePrecedente(query: AnalyticsQuery): AnalyticsQuery {
  return { ...query, range: previousRange(query.range) };
}

/**
 * Visiteurs distincts (identifiant ALÉATOIRE seulement) des sessions commencées
 * dans la fenêtre : le calcul de l'Explorer (`VISITEURS_DISTINCTS`), pas une
 * seconde définition. Un distinct ne s'additionne pas d'une période à l'autre :
 * la période précédente est relue, jamais déduite.
 */
export async function visiteursDistincts(query: AnalyticsQuery, shift = false): Promise<number | null> {
  const resultat = await exploreAnalytics({ query: shift ? periodePrecedente(query) : query, plan: PLAN_VISITEURS_DISTINCTS });
  return resultat.data.total;
}

export interface RepartitionSessions {
  /** Sessions commencées de la fenêtre : le tout dont chaque groupe est une part. */
  total: number;
  /** Au plus `REPARTITION_LIMITE` groupes, du plus fourni au moins fourni ; `valeur: null` = « Inconnu ». */
  groupes: { valeur: string | null; sessions: number }[];
  /** Plus de groupes que la limite : les suivants ne sont pas affichés (et le reste est dit). */
  tronque: boolean;
}

/** « Qui sont ces sessions » : sessions commencées par valeur d'une dimension de session. */
export async function repartitionSessions(query: AnalyticsQuery, dimension: Dimension): Promise<RepartitionSessions> {
  const { data, meta } = await exploreAnalytics({ query, plan: planRepartition(dimension) });
  return {
    total: data.total ?? 0,
    groupes: data.groups.map((g) => ({ valeur: g.key[0] ?? null, sessions: g.value ?? 0 })),
    tronque: meta.truncated_groups,
  };
}

// ═══════════════ Frustration et rejeu des lignes de la liste (recette du 26/09) ═══════════════
//
// La table « Toutes les sessions » forçait ces deux colonnes à `null` : « — » sur
// chaque ligne, alors que 140 sessions de la démo avaient un rejeu que leur détail
// lisait. Deux faits PAR SESSION, lus pour les seules lignes de la page affichée
// (50 au plus), jamais pour la fenêtre : un compte, une existence.
//
//   - frustration : signaux `frustration.rage|dead|error` de la session, toute sa
//     durée. `null` pour une session React Native : son SDK n'en émet aucun, et
//     « 0 » y affirmerait un calme que personne n'a écouté (garde de capteur R-F) ;
//   - rejeu : un segment existe-t-il, DANS LA MÊME APP (l'identifiant de session est
//     émis par le client ; un segment d'une autre app ne fait pas un rejeu).
//
// COÛT. `rum_event` n'a pas d'index par session : la lecture passe par l'index
// (app, nom, instant), bornée à l'intervalle couvert par les sessions de la page,
// une heure de marge de chaque côté (horloges clientes). Le rejeu passe par
// `idx_replay_session`.

/** Les deux signaux d'une ligne ; `frustration: null` = non collecté (capteur mobile). */
export interface SignauxSession {
  frustration: number | null;
  rejeu: boolean;
}

/** Clé d'une session dans le dictionnaire des signaux : app et identifiant, jamais l'identifiant seul. */
export function cleSession(s: { app_id: string; session_id: string }): string {
  return `${s.app_id}\u0000${s.session_id}`;
}

export async function signauxDesSessions(
  lignes: readonly {
    app_id: string;
    session_id: string;
    runtime?: string | null;
    started_at: Date | string;
    last_seen_at: Date | string;
  }[],
): Promise<Record<string, SignauxSession>> {
  if (lignes.length === 0) return {};
  const ms = (d: Date | string) => new Date(d).getTime();
  const debut = new Date(Math.min(...lignes.map((l) => ms(l.started_at))) - 3_600_000);
  const fin = new Date(Math.max(...lignes.map((l) => ms(l.last_seen_at))) + 3_600_000);
  const rows = await q<{ app_id: string; session_id: string; frustration: number; rejeu: boolean }>(
    `with l as (
       select * from unnest($1::text[], $2::text[]) as l(app_id, session_id)
     ), signaux as (
       select e.app_id, e.session_id, count(*)::int as n
         from rum_event e
         join l on l.app_id = e.app_id and l.session_id = e.session_id
        where e.app_id = any($1::text[])
          and e.name in ('frustration.rage', 'frustration.dead', 'frustration.error')
          and e.ts >= $3 and e.ts <= $4
        group by 1, 2
     )
     select l.app_id, l.session_id, coalesce(sg.n, 0)::int as frustration,
            exists (select 1 from replay_chunk r where r.session_id = l.session_id and r.app_id = l.app_id) as rejeu
       from l
       left join signaux sg on sg.app_id = l.app_id and sg.session_id = l.session_id`,
    [lignes.map((l) => l.app_id), lignes.map((l) => l.session_id), debut, fin],
  );
  const mobile = new Set(lignes.filter((l) => l.runtime === MOBILE_RUNTIME).map(cleSession));
  const sortie: Record<string, SignauxSession> = {};
  for (const r of rows) {
    const cle = cleSession(r);
    sortie[cle] = { frustration: mobile.has(cle) ? null : r.frustration, rejeu: r.rejeu === true };
  }
  return sortie;
}
