// Requêtes « déploiements & régression » (Voie A · inc. 3). Un marqueur de
// déploiement croisé aux métriques RUM répond à « et l'heure de régression » :
// on compare le p75 LCP et le volume d'erreurs sur la fenêtre AVANT vs APRÈS le
// dernier déploiement. Marqueurs et fenêtres ±2 h sont bornés par le périmètre d'apps de la requête
// commune (P6.2), jamais par ses filtres de population : le panneau le dit.
import { q } from "./db";
import { queryOf, type Filters } from "./filters";
import { binder, compileScope, sessionJoin } from "./query-compiler";
import { softFail, sqlContext, type SqlContext } from "./query-sql";

export interface DeployRow {
  id: number;
  ts: Date;
  version: string | null;
  env: string;
  source: string;
}

/** Marqueurs de déploiement récents du périmètre. */
export async function listDeploys(f: Filters, limit = 20): Promise<DeployRow[]> {
  const { params, bind } = binder();
  return q<DeployRow>(
    `select dm.id, dm.ts, dm.version, dm.env, dm.source
       from deploy_marker dm
      where true${compileScope(queryOf(f), "dm.app_id", bind)}
      order by dm.ts desc
      limit ${Number(limit)}`,
    params,
  );
}

/** Enregistre un déploiement (appelé par l'endpoint CI/CD). */
export async function recordDeploy(
  appId: string,
  version: string | null,
  env: string,
  source: string,
  ts?: Date,
): Promise<void> {
  await q(
    `insert into deploy_marker (app_id, version, env, source, ts)
     values ($1, $2, $3, $4, coalesce($5, now()))`,
    [appId, version, env, source, ts ?? null],
  );
}

export interface DeployImpact {
  deploy_ts: Date | null;
  version: string | null;
  env: string | null;
  lcp_before: number | null;
  lcp_after: number | null;
  errors_before: number;
  errors_after: number;
}

/**
 * Impact du DERNIER déploiement : p75 LCP et nombre d'erreurs JS sur les 2 h qui
 * précèdent vs les 2 h qui suivent. null partout si aucun déploiement.
 */
export async function latestDeployImpact(f: Filters): Promise<DeployImpact | null> {
  const query = queryOf(f);
  const { params, bind } = binder();
  // Mesures lues dans l'app DU marqueur : un déploiement de A ne juge pas le LCP de B.
  const [row] = await q<DeployImpact>(
    `with d as (
       select dm.app_id, dm.ts, dm.version, dm.env from deploy_marker dm
       where true${compileScope(query, "dm.app_id", bind)}
       order by dm.ts desc limit 1
     )
     select
       (select ts from d)      as deploy_ts,
       (select version from d) as version,
       (select env from d)     as env,
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m, d
         where m.name = 'LCP' and m.app_id = d.app_id
           and m.ts >= d.ts - interval '2 hours' and m.ts < d.ts) as lcp_before,
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m, d
         where m.name = 'LCP' and m.app_id = d.app_id
           and m.ts >= d.ts and m.ts < d.ts + interval '2 hours') as lcp_after,
       coalesce((select sum(e.occurrences) from rum_error e, d
          where e.app_id = d.app_id
            and e.ts >= d.ts - interval '2 hours' and e.ts < d.ts), 0)::int as errors_before,
       coalesce((select sum(e.occurrences) from rum_error e, d
          where e.app_id = d.app_id
            and e.ts >= d.ts and e.ts < d.ts + interval '2 hours'), 0)::int as errors_after`,
    params,
  );
  return row?.deploy_ts ? row : null;
}

export interface RegressionVerdict {
  regressed: boolean;
  deltaPct: number | null;
}

/**
 * Verdict de régression pour une mesure « plus haut = pire » (LCP, taux d'erreur).
 * Régression si l'après dépasse l'avant d'au moins `ratio` (défaut +20 %). Pur.
 */
export function assessRegression(
  before: number | null,
  after: number | null,
  ratio = 1.2,
): RegressionVerdict {
  if (before == null || after == null || before <= 0) return { regressed: false, deltaPct: null };
  const deltaPct = Math.round(((after - before) / before) * 100);
  return { regressed: after >= before * ratio, deltaPct };
}

export interface VersionRow {
  version: string;
  sessions: number;
  lcp: number | null;
  inp: number | null;
  erreurs: number;
  /** Sessions ayant produit au moins une erreur — la base du taux affiché. */
  sessionsEnErreur: number;
}

/**
 * D'où vient la release de chaque ligne : de l'ÉVÉNEMENT (migration-v75, P6.1)
 * ou, à défaut de ces colonnes, de la session.
 */
export type VersionSource = "occurrence" | "session";

export interface ComparaisonVersions {
  rows: VersionRow[];
  source: VersionSource;
}

/** Libellé du groupe des mesures qui ne déclarent aucune release. */
const SANS_RELEASE = "(non renseignée)";

/**
 * Comparaison des versions déployées : volume, LCP, INP et erreurs par release.
 *
 * LA RELEASE VIENT DE CHAQUE MESURE, PAS DE LA SESSION (P6.1, suivi P6.2).
 * `rum_session.release` retient la PREMIÈRE release vue et ne bouge plus : une
 * session qui traverse un déploiement faisait porter à l'ancienne version des
 * mesures produites par la nouvelle, et un rechargement en cours de session
 * réécrivait rétroactivement le passé. Depuis migration-v75, la vue, la métrique
 * et l'erreur portent chacune la release DÉCLARÉE AU MOMENT où elles sont
 * survenues : chaque chiffre est attribué à la version qui l'a réellement
 * produit, et une session à cheval compte dans les deux — c'est ce qu'on veut
 * voir, pas un défaut.
 *
 * DÉNOMINATEUR : les sessions DISTINCTES ayant vu au moins une page sous cette
 * release. Deux versions peuvent donc totaliser plus que le nombre de sessions
 * de la fenêtre ; le libellé de l'écran le dit.
 *
 * TAUX D'ERREUR PAR SESSION, pas par page vue : entre deux versions, ce qui se
 * compare est la probabilité qu'un visiteur rencontre un bug, pas le nombre de
 * fois où la même exception se répète dans une boucle.
 *
 * AVANT migration-v75, les colonnes par occurrence n'existent pas : la lecture
 * retombe sur la release de session, à l'identique de ce qui précédait, et
 * `source` le dit à l'écran plutôt que de laisser croire au découpage fin.
 */
export async function comparaisonVersions(f: Filters, limit = 12): Promise<ComparaisonVersions> {
  try {
    const sql = await sqlContext(f);
    const parOccurrence =
      sql.schema.has("rum_pageview.release") && sql.schema.has("rum_metric.release") && sql.schema.has("rum_error.release");
    const rows = parOccurrence ? await parOccurrenceSql(sql, limit) : await parSessionSql(sql, limit);
    return { rows, source: parOccurrence ? "occurrence" : "session" };
  } catch (e) {
    return softFail(e, { rows: [], source: "occurrence" as VersionSource });
  }
}

/** Release de l'événement : chaque famille de mesures porte la sienne. */
async function parOccurrenceSql(sql: SqlContext, limit: number): Promise<VersionRow[]> {
  const vues = sql.where({ dataset: "views", row: "p", session: "ps", time: "p.started_at" });
  const mesures = sql.where({ dataset: "vitals", row: "x", session: "ms", time: "x.ts" });
  const erreurs = sql.where({ dataset: "errors", row: "x", session: "es", time: "x.ts" });
  const sans = sql.bind(SANS_RELEASE);
  return q<VersionRow>(
    `with v as (
       select coalesce(nullif(p.release, ''), ${sans}) as version,
              count(distinct (p.app_id, p.session_id))::int as sessions
         from rum_pageview p
         ${sessionJoin("p", "ps")}
        where true${vues}
        group by 1
     ),
     m as (
       select coalesce(nullif(x.release, ''), ${sans}) as version, x.name, x.value
         from rum_metric x
         ${sessionJoin("x", "ms")}
        where x.name in ('LCP', 'INP')${mesures}
     ),
     e as (
       select coalesce(nullif(x.release, ''), ${sans}) as version,
              coalesce(sum(x.occurrences), 0)::int as erreurs,
              count(distinct x.session_id)::int as "sessionsEnErreur"
         from rum_error x
         ${sessionJoin("x", "es")}
        where true${erreurs}
        group by 1
     )
     select v.version, v.sessions,
            (select percentile_cont(0.75) within group (order by value)
               from m where m.version = v.version and m.name = 'LCP') as lcp,
            (select percentile_cont(0.75) within group (order by value)
               from m where m.version = v.version and m.name = 'INP') as inp,
            coalesce(e.erreurs, 0) as erreurs,
            coalesce(e."sessionsEnErreur", 0) as "sessionsEnErreur"
       from v left join e on e.version = v.version
      order by v.sessions desc, v.version asc
      limit ${Number(limit)}`,
    sql.params,
  );
}

/** Repli avant migration-v75 : la release de la session porte toutes ses mesures. */
async function parSessionSql(sql: SqlContext, limit: number): Promise<VersionRow[]> {
  const where = sql.where({ dataset: "sessions", row: "rs", session: "rs", time: "rs.last_seen_at" });
  const sans = sql.bind(SANS_RELEASE);
  return q<VersionRow>(
    `with s as (
       select rs.app_id, rs.session_id, coalesce(nullif(rs.release, ''), ${sans}) as version
       from rum_session rs
       where true${where}
     ),
     v as (select version, count(*)::int as sessions from s group by 1),
     m as (select s.version, x.name, x.value from rum_metric x join s on s.app_id = x.app_id and s.session_id = x.session_id
           where x.name in ('LCP', 'INP')),
     e as (select s.version, coalesce(sum(x.occurrences), 0)::int as erreurs,
                  count(distinct x.session_id)::int as "sessionsEnErreur"
           from rum_error x join s on s.app_id = x.app_id and s.session_id = x.session_id group by 1)
     select v.version, v.sessions,
            (select percentile_cont(0.75) within group (order by value)
               from m where m.version = v.version and m.name = 'LCP') as lcp,
            (select percentile_cont(0.75) within group (order by value)
               from m where m.version = v.version and m.name = 'INP') as inp,
            coalesce(e.erreurs, 0) as erreurs,
            coalesce(e."sessionsEnErreur", 0) as "sessionsEnErreur"
     from v left join e on e.version = v.version
     order by v.sessions desc, v.version asc
     limit ${Number(limit)}`,
    sql.params,
  );
}

// ─────────── Lecture d'une comparaison de versions : décisions PURES ───────────
// Extraites du composant pour être vérifiables. Chacune répond à une question où
// l'erreur ne lève rien et se lit comme un résultat : afficher un tableau d'une
// ligne, désigner la mauvaise référence, ou montrer un écart de « +0 % » sur la
// ligne de référence elle-même.

/**
 * Y a-t-il quelque chose à COMPARER ?
 *
 * Sous deux versions, non : une « comparaison » d'une seule ligne n'apprend
 * rien, et sur une app qui ne renseigne pas `release` elle afficherait
 * éternellement « (non renseignée) » comme s'il s'agissait d'un résultat.
 */
export function comparable(rows: VersionRow[]): boolean {
  return rows.length >= 2;
}

/**
 * La version de RÉFÉRENCE : la plus vue, pas la plus récente.
 *
 * C'est celle dont les chiffres sont les plus solides. Et « la plus récente »
 * n'est pas calculable de façon fiable : « 1.10 » vient après « 1.9 » alors que
 * l'ordre alphabétique dit l'inverse, et un SHA git n'a aucun ordre. La requête
 * classe déjà par volume décroissant ; on ne re-trie pas, on prend la première.
 */
export function versionReference(rows: VersionRow[]): VersionRow | null {
  return rows.length ? rows[0] : null;
}

/**
 * Part des sessions ayant rencontré au moins une erreur — pas le nombre
 * d'erreurs. Entre deux versions, ce qui se compare est la probabilité qu'un
 * visiteur tombe sur un bug, pas le nombre de fois où la même exception se
 * répète dans une boucle. `null` si la version n'a aucune session : une
 * division par zéro afficherait « 0 % », c'est-à-dire « aucune erreur ».
 */
export function tauxErreur(r: VersionRow): number | null {
  return r.sessions > 0 ? r.sessionsEnErreur / r.sessions : null;
}

/**
 * Écart de taux d'erreur face à la référence, EN POINTS de pourcentage.
 *
 * `null` sur la ligne de référence elle-même : « +0,0 pt » face à soi-même se
 * lit comme une mesure, alors que c'est une tautologie. `null` aussi dès qu'un
 * des deux taux manque — comparer à rien donnerait l'autre taux tel quel,
 * présenté comme un écart.
 */
export function ecartPoints(r: VersionRow, ref: VersionRow): number | null {
  if (r.version === ref.version) return null;
  const a = tauxErreur(r);
  const b = tauxErreur(ref);
  return a == null || b == null ? null : (a - b) * 100;
}
