// Requêtes /tracing (v0.4) — corrélation front↔back par trace_id (rum_span).
// Contrat commun P6.2 : plage [from,to), périmètre d'apps, route, dimensions de
// session et bots compilés en paramètres liés. Le jumeau backend est cherché DANS
// LA MÊME APP : un trace_id est émis par le client, deux tenants peuvent le partager.
import { q } from "./db";
import { type FiltersLike } from "./filters";
import { bucketExpr, bucketSeriesSql, sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";
import type { Appel } from "./tracing-ancres";

export interface TraceCoverage {
  total: number; // appels API vus du navigateur (spans front)
  correlated: number; // dont jumeau backend trouvé (même app, même trace, span serveur enfant de l'appel)
  back_total: number; // spans back reçus (inclut le trafic sans front : robots, curl)
  front_p75: number | null;
  back_p75: number | null;
  /**
   * Appels front en échec : statut ≥ 400, ou 0 / absent (coupure réseau, requête
   * annulée) — même prédicat que `apiCalls.err`. Sert la tuile « Appels en échec »
   * (T5, F59) ; NON publié par `GET /api/v1/tracing`, dont le contrat reste celui
   * d'avant F59 : la route projette les cinq champs historiques.
   */
  err: number;
}

/**
 * Le jumeau serveur d'UN appel navigateur : même app, même trace, et surtout le
 * span serveur dont le parent est CET appel (`b.parent_span_id = fr.span_id`).
 *
 * POURQUOI LE PARENT. Depuis E0, tous les appels d'une page vue partagent le
 * `trace_id` de la vue (`packages/rum-sdk/src/index.ts`, `traceId: currentTraceId`) ;
 * chaque appel garde son propre `spanId` dans `traceparent`, que le middleware
 * serveur (FastAPI, agent Node, OTel) recopie en `parent_span_id` de son span
 * (`apps/ingest/…/otlp.mjs`, `spanRow`). Apparier par `trace_id` seul croisait
 * donc chaque appel avec les réponses serveur de TOUS les appels de la vue :
 * deux appels comptaient quatre fois, et le p75 serveur de `/api/config`
 * portait sur la réponse de `/api/search`. La chronologie de session appariait
 * déjà par le parent (lib/queries.ts, `child.parent_span_id = f.span_id`).
 *
 * Limite : un proxy instrumenté qui s'intercalerait (serveur enfant du proxy,
 * pas de l'appel) laisserait l'appel « non suivi » plutôt que mal apparié.
 */
const JUMEAU_BACK =
  "left join rum_span b on b.app_id = fr.app_id and b.trace_id = fr.trace_id and b.tier = 'back' and b.parent_span_id = fr.span_id";

/**
 * Chemin vu du navigateur, origine retirée. UNE expression pour le regroupement
 * des appels, le filtre `appel` des traces lentes et leur affichage : un appel
 * classé et les traces qu'il ouvre ne peuvent pas diverger sur la normalisation.
 */
const CHEMIN = "regexp_replace(coalesce(fr.url, ''), '^https?://[^/]+', '')";

/** Échec d'un appel front : statut ≥ 400, ou 0 / absent (coupure réseau, requête annulée). */
const ECHEC = "coalesce(fr.status_code, 0) >= 400 or coalesce(fr.status_code, 0) = 0";

/** Effectif sous lequel un appel passe en fin de classement (gravité, § 5.8.3). */
const EFFECTIF_FAIBLE = 30;

export async function traceCoverage(f: FiltersLike): Promise<TraceCoverage> {
  const sql = await sqlContext(f);
  const front = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  const back = sql.where({ dataset: "spans", row: "bk", session: "bs", time: "bk.ts" });
  const [row] = await q<TraceCoverage>(
    `select
       count(*) filter (where fr.tier = 'front')::int as total,
       count(b.span_id)::int as correlated,
       count(*) filter (where ${ECHEC})::int as err,
       (select count(*)::int from rum_span bk
         ${sessionJoin("bk", "bs")}
         where bk.tier = 'back'${back}) as back_total,
       percentile_cont(0.75) within group (order by fr.duration_ms) as front_p75,
       percentile_cont(0.75) within group (order by b.duration_ms) as back_p75
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${front}`,
    sql.params,
  );
  return row;
}

export interface ApiCallRow {
  url: string; // chemin vu du navigateur (origin retirée)
  method: string;
  n: number;
  front_p75: number;
  back_p75: number | null;
  err: number; // statuts >= 400 ou 0 (réseau)
}

/** Appels API vus du navigateur, avec le temps serveur corrélé quand il existe. */
export async function apiCalls(f: FiltersLike): Promise<ApiCallRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  return q<ApiCallRow>(
    `select ${CHEMIN} as url,
            fr.method,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by fr.duration_ms) as front_p75,
            percentile_cont(0.75) within group (order by b.duration_ms)
              filter (where b.duration_ms is not null) as back_p75,
            count(*) filter (where ${ECHEC})::int as err
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${where}
     group by 1, 2
     order by front_p75 desc nulls last
     limit 50`,
    sql.params,
  );
}

export interface ApiCallDecomposition {
  url: string; // chemin vu du navigateur (origine retirée, expression `CHEMIN`)
  method: string;
  /** Appels vus du navigateur. */
  n: number;
  /** Dont appels suivis : jumeau serveur trouvé (même app, même trace, enfant de l'appel). */
  n_suivis: number;
  front_p75: number | null;
  /** p75 serveur des seuls appels suivis. */
  back_p75: number | null;
  /** p75 du trajet (réseau, proxy, TLS) calculé TRACE PAR TRACE, jamais `front_p75 − back_p75`. */
  reseau_p75: number | null;
  /** Médiane, appel par appel, de durée serveur / durée navigateur, bornée à [0, 1] : une proportion. */
  part_serveur_p50: number | null;
  err: number; // statuts ≥ 400 ou 0 (réseau)
}

/**
 * Décomposition de chaque appel API (§ 5.8.3, lecture commune du classement T6
 * et de la table T8). Même source et même jointure « jumeau serveur dans la même
 * app » que `apiCalls`, qu'elle remplace à l'écran (l'API v1 garde `apiCalls`).
 *
 * TROIS MESURES QUI NE SE SOUSTRAIENT PAS. `front_p75 − back_p75` n'est la durée
 * de personne : les deux p75 ne tombent pas sur le même appel, et le second ne
 * porte que sur les appels suivis. Le trajet est donc calculé par trace
 * (`greatest(front − back, 0)`, comme `slowTraces`) PUIS agrégé ; la part serveur
 * est un rapport par appel, puis sa médiane — une proportion, jamais des ms.
 *
 * `greatest` et `least` IGNORENT NULL en PostgreSQL (`greatest(null, 0) = 0`) :
 * sans le `case`, chaque appel non suivi compterait un trajet de 0 ms et une part
 * serveur nulle. Le `case` rend NULL, que `percentile_cont` écarte.
 *
 * Gravité : les appels d'au moins 30 occurrences d'abord, puis `front_p75`
 * décroissant — un p75 sur trois appels ne passe pas devant un p75 sur trois
 * cents. 50 lignes au plus.
 */
export async function apiCallsDecomposition(f: FiltersLike): Promise<ApiCallDecomposition[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  return q<ApiCallDecomposition>(
    `select ${CHEMIN} as url,
            fr.method,
            count(*)::int as n,
            count(b.span_id)::int as n_suivis,
            percentile_cont(0.75) within group (order by fr.duration_ms) as front_p75,
            percentile_cont(0.75) within group (order by b.duration_ms) as back_p75,
            percentile_cont(0.75) within group (
              order by case when b.duration_ms is not null
                            then greatest(fr.duration_ms - b.duration_ms, 0) end) as reseau_p75,
            percentile_cont(0.5) within group (
              order by case when b.duration_ms is not null and fr.duration_ms > 0
                            then least(greatest(b.duration_ms / fr.duration_ms, 0), 1) end) as part_serveur_p50,
            count(*) filter (where ${ECHEC})::int as err
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${where}
     group by 1, 2
     order by count(*) < ${EFFECTIF_FAIBLE}, front_p75 desc nulls last, 2, 1
     limit 50`,
    sql.params,
  );
}

export interface SpanLatencyPoint {
  /** Début du seau, ISO UTC (grille `bucketStarts` du contrat). */
  t: string;
  front_p75: number | null;
  /** p75 serveur des appels suivis du seau. */
  back_p75: number | null;
  /** Appels vus du navigateur dans le seau ; 0 pour un seau vide. */
  n: number;
}

/**
 * Latence des appels par seau du contrat (T7) : p75 navigateur et p75 serveur
 * des appels SUIVIS, deux séries jamais empilées. Tous les seaux de [from,to)
 * sont rendus ; un seau sans appel vaut `null` (un trou, pas un zéro) avec `n = 0`.
 *
 * Pourquoi pas l'Explorer : son jeu `spans` agrège le serveur sans savoir
 * restreindre aux appels suivis, et son p75 « back » inclurait robots et curl.
 * Le seau suit l'instant de l'appel navigateur (`fr.ts`).
 */
export async function spanLatencySeries(f: FiltersLike): Promise<SpanLatencyPoint[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  const serie = bucketSeriesSql(sql.query.range, sql.bind);
  const lignes = await q<Omit<SpanLatencyPoint, "t"> & { t: Date }>(
    `with agrege as (
       select ${bucketExpr("fr.ts", sql.query.range)} as t,
              count(*)::int as n,
              percentile_cont(0.75) within group (order by fr.duration_ms) as front_p75,
              percentile_cont(0.75) within group (order by b.duration_ms) as back_p75
         from rum_span fr
         ${JUMEAU_BACK}
         ${sessionJoin("fr", "s")}
        where fr.tier = 'front'${where}
        group by 1
     )
     select seau.t, a.front_p75, a.back_p75, coalesce(a.n, 0) as n
       from ${serie} as seau(t)
       left join agrege a on a.t = seau.t
      order by 1`,
    sql.params,
  );
  // timestamptz → Date par node-postgres : l'instant est exact, l'ISO est UTC.
  return lignes.map((l) => ({ ...l, t: l.t.toISOString() }));
}

export interface BackRouteRow {
  route: string;
  n: number;
  p75: number;
  p95: number;
  err: number;
}

/** Routes backend (templates FastAPI) — la vue « serveur » ; un filtre de session écarte le trafic sans session. */
export async function backRoutes(f: FiltersLike): Promise<BackRouteRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "bk", session: "s", time: "bk.ts" });
  return q<BackRouteRow>(
    `select coalesce(bk.route, '—') as route,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by bk.duration_ms) as p75,
            percentile_cont(0.95) within group (order by bk.duration_ms) as p95,
            count(*) filter (where coalesce(bk.status_code, 0) >= 500)::int as err
     from rum_span bk
     ${sessionJoin("bk", "s")}
     where bk.tier = 'back'${where}
     group by 1
     order by p75 desc nulls last
     limit 50`,
    sql.params,
  );
}

export interface SlowTrace {
  trace_id: string;
  /** Span navigateur de L'APPEL : une trace de page vue en porte plusieurs (E0), le détail s'ouvre sur celui-ci (`?span=`). */
  span_id: string;
  session_id: string | null;
  url: string;
  method: string;
  front_status: number | null;
  front_ms: number;
  back_ms: number | null;
  network_ms: number | null;
  ts: Date;
}

export interface TraceSpanRow {
  span_id: string;
  parent_span_id: string | null;
  tier: "front" | "back" | "detail";
  name: string | null;
  kind: string | null;
  route: string | null;
  url: string | null;
  method: string | null;
  status_code: number | null;
  duration_ms: number;
  ts: Date;
  app_id: string;
  session_id: string | null;
}

/**
 * Tous les spans d'une trace (front + back + detail), ordonnés par début — la
 * matière du waterfall « douleur utilisateur → cause backend ». `ts` porte le
 * début de span (nanosToDate à l'ingestion), donc les offsets se calculent par
 * différence côté rendu.
 *
 * `opts.apps` restreint aux apps autorisées ET demandées (P5.1) : un trace_id est
 * émis par le client, deux tenants peuvent donc le partager, et un lien depuis
 * une erreur de l'app A ne doit jamais montrer les spans de B. `null` = aucune
 * restriction ; `[]` = aucune app, donc aucun span.
 */
export async function traceSpans(
  traceId: string,
  opts?: { apps?: string[] | null },
): Promise<TraceSpanRow[]> {
  return q<TraceSpanRow>(
    `select span_id, parent_span_id, tier, name, kind, route, url, method,
            status_code, duration_ms, ts, app_id, session_id
       from rum_span
      where trace_id = $1
        and ($2::text[] is null or app_id = any($2::text[]))
      order by ts asc, case tier when 'front' then 0 when 'back' then 1 else 2 end`,
    [traceId, opts?.apps ?? null],
  );
}

export interface TraceErrorRow {
  /** App du groupe : une empreinte n'identifie un groupe que dans son app. */
  app_id: string;
  fingerprint: string;
  /** Message de l'occurrence la plus récente du groupe dans cette trace. */
  message: string | null;
  /** `sum(occurrences)` (V1), jamais un compte de lignes. */
  occurrences: number;
  /** Span parent de l'occurrence la plus récente qui en cite un EXISTANT dans la même app et la même trace ; sinon null. */
  source_parent_span_id: string | null;
}

/**
 * Groupes d'erreurs portant cet identifiant de trace (« Erreurs liées à cette
 * trace », TD4), dans les apps données — même sémantique que `traceSpans` :
 * `null` = aucune restriction (admin sans app demandée), `[]` = aucune app, donc
 * aucune ligne. Un trace_id est émis par le client : deux tenants peuvent le
 * partager, et l'erreur de B ne se lit jamais depuis A.
 *
 * Le périmètre est une clause AJOUTÉE quand il existe, jamais
 * `($n is null or app_id = …)` (R-A) : `null` n'arrive ici que d'un principal
 * sans restriction (`traceApps`), pas d'un « toutes les apps » demandé.
 *
 * Span parent vérifié : identifiants de trace et de span sont émis par le client ;
 * sans la preuve qu'il existe dans la même app et la même trace, un lien `?span=`
 * ouvrirait un segment qui n'est pas là (ou celui d'un autre tenant).
 *
 * Sans empreinte, une erreur n'a pas de page de groupe : elle n'est pas listée.
 * Colonnes v69 (`trace_id`, `source_parent_span_id`) : une base plus ancienne
 * échoue, et la section qui lit (`lire()`) le dit.
 */
export async function errorsOfTrace(traceId: string, opts: { apps: string[] | null }): Promise<TraceErrorRow[]> {
  if (opts.apps !== null && opts.apps.length === 0) return [];
  const params: unknown[] = [traceId];
  const perimetre = opts.apps === null ? "" : ` and e.app_id = any($${params.push(opts.apps)}::text[])`;
  return q<TraceErrorRow>(
    `select e.app_id, e.fingerprint,
            (array_agg(e.message order by e.ts desc, e.id desc))[1] as message,
            sum(e.occurrences)::float8 as occurrences,
            (array_agg(e.source_parent_span_id order by e.ts desc, e.id desc)
               filter (where exists (
                 select 1 from rum_span sp
                  where sp.app_id = e.app_id and sp.trace_id = e.trace_id
                    and sp.span_id = e.source_parent_span_id)))[1] as source_parent_span_id
       from rum_error e
      where e.trace_id = $1
        and e.fingerprint is not null${perimetre}
      group by e.app_id, e.fingerprint
      order by occurrences desc, e.fingerprint, e.app_id`,
    params,
  );
}

/**
 * Les appels les plus lents de la plage, décomposés front / serveur / réseau.
 *
 * `opts.appel` restreint à UN appel (paramètre d'écran `appel=<méthode> <chemin>`,
 * lu par `lireAppel`) : même méthode et même chemin — l'expression `CHEMIN` qui
 * regroupe les appels de `apiCallsDecomposition` —, valeurs liées. Filtre
 * d'écran : il ne change aucun chiffre d'une autre section.
 */
export async function slowTraces(f: FiltersLike, opts?: { appel?: Appel }): Promise<SlowTrace[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "spans", row: "fr", session: "s", time: "fr.ts" });
  const appel = opts?.appel
    ? ` and fr.method = ${sql.bind(opts.appel.method)} and ${CHEMIN} = ${sql.bind(opts.appel.url)}`
    : "";
  return q<SlowTrace>(
    `select fr.trace_id, fr.span_id, fr.session_id,
            ${CHEMIN} as url,
            fr.method, fr.status_code as front_status, fr.duration_ms as front_ms,
            b.duration_ms as back_ms,
            case when b.duration_ms is not null then greatest(fr.duration_ms - b.duration_ms, 0) end as network_ms,
            fr.ts
     from rum_span fr
     ${JUMEAU_BACK}
     ${sessionJoin("fr", "s")}
     where fr.tier = 'front'${where}${appel}
     order by fr.duration_ms desc
     limit 20`,
    sql.params,
  );
}
