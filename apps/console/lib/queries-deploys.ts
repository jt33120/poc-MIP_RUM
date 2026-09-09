// Requêtes « déploiements & régression » (Voie A · inc. 3). Un marqueur de
// déploiement croisé aux métriques RUM répond à « et l'heure de régression » :
// on compare le p75 LCP et le volume d'erreurs sur la fenêtre AVANT vs APRÈS le
// dernier déploiement. Convention : $1 = app (null = toutes).
import { q } from "./db";
import { type Filters, PERIODS } from "./filters";

export interface DeployRow {
  id: number;
  ts: Date;
  version: string | null;
  env: string;
  source: string;
}

/** Marqueurs de déploiement récents pour l'app filtrée. */
export async function listDeploys(f: Filters, limit = 20): Promise<DeployRow[]> {
  return q<DeployRow>(
    `select id, ts, version, env, source
       from deploy_marker
      where ($1::text is null or app_id = $1)
      order by ts desc
      limit ${Number(limit)}`,
    [f.app],
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
  const [row] = await q<DeployImpact>(
    `with d as (
       select ts, version, env from deploy_marker
       where ($1::text is null or app_id = $1)
       order by ts desc limit 1
     )
     select
       (select ts from d)      as deploy_ts,
       (select version from d) as version,
       (select env from d)     as env,
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m, d
         where m.name = 'LCP' and ($1::text is null or m.app_id = $1)
           and m.ts >= d.ts - interval '2 hours' and m.ts < d.ts) as lcp_before,
       (select percentile_cont(0.75) within group (order by m.value)
          from rum_metric m, d
         where m.name = 'LCP' and ($1::text is null or m.app_id = $1)
           and m.ts >= d.ts and m.ts < d.ts + interval '2 hours') as lcp_after,
       coalesce((select count(*) from rum_error e, d
          where ($1::text is null or e.app_id = $1)
            and e.ts >= d.ts - interval '2 hours' and e.ts < d.ts), 0)::int as errors_before,
       coalesce((select count(*) from rum_error e, d
          where ($1::text is null or e.app_id = $1)
            and e.ts >= d.ts and e.ts < d.ts + interval '2 hours'), 0)::int as errors_after`,
    [f.app],
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
 * Comparaison des versions déployées : volume, LCP, INP et erreurs par release.
 *
 * `rum_session.release` est collecté depuis le SDK (attribut `mip.release`) et
 * n'était restitué NULLE PART : la donnée existait, l'écran manquait. C'est ce
 * que la roue des blocs annonçait comme « Comparaison par version d'app ».
 *
 * POURQUOI PASSER PAR LA SESSION et non par `rum_error.release`, qui existe
 * aussi : `rum_metric` n'a pas de colonne release, et faire porter le LCP par
 * une table et les erreurs par une autre donnerait deux dénominateurs
 * différents — un taux d'erreur calculé sur des ensembles de sessions qui ne se
 * recouvrent pas. La session est le seul point commun ; c'est donc elle qui
 * porte l'appartenance à une version.
 *
 * TAUX D'ERREUR PAR SESSION, pas par page vue : entre deux versions, ce qui se
 * compare est la probabilité qu'un visiteur rencontre un bug, pas le nombre de
 * fois où la même exception se répète dans une boucle.
 */
export async function comparaisonVersions(f: Filters, limit = 12): Promise<VersionRow[]> {
  const itv = PERIODS[f.period].interval;
  try {
    return await q<VersionRow>(
      `with s as (
         select session_id, coalesce(nullif(release, ''), '(non renseignée)') as version
         from rum_session
         where last_seen_at > now() - interval '${itv}'
           and ($1::text is null or app_id = $1)
           and ($2::text is null or device_type = $2)
           and not coalesce(is_bot, false)
       ),
       v as (select version, count(*)::int as sessions from s group by 1),
       m as (select s.version, x.name, x.value from rum_metric x join s using (session_id)
             where x.name in ('LCP', 'INP')),
       e as (select s.version, count(*)::int as erreurs,
                    count(distinct x.session_id)::int as "sessionsEnErreur"
             from rum_error x join s using (session_id) group by 1)
       select v.version, v.sessions,
              (select percentile_cont(0.75) within group (order by value)
                 from m where m.version = v.version and m.name = 'LCP') as lcp,
              (select percentile_cont(0.75) within group (order by value)
                 from m where m.version = v.version and m.name = 'INP') as inp,
              coalesce(e.erreurs, 0) as erreurs,
              coalesce(e."sessionsEnErreur", 0) as "sessionsEnErreur"
       from v left join e on e.version = v.version
       order by v.sessions desc
       limit ${Number(limit)}`,
      [f.app, f.device],
    );
  } catch {
    return [];
  }
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
