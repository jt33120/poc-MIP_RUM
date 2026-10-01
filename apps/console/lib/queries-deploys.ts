// Requêtes « déploiements & régression » (Voie A · inc. 3). Un marqueur de
// déploiement croisé aux métriques RUM répond à « et l'heure de régression » :
// on compare le p75 LCP et le volume d'erreurs sur la fenêtre AVANT vs APRÈS le
// dernier déploiement. Marqueurs et fenêtres ±2 h sont bornés par le périmètre d'apps de la requête
// commune (P6.2), jamais par ses filtres de population : le panneau le dit.
import { enregistrerDeploiement } from "@mip/backend/lib/deploiements.mjs";
import {
  EFFECTIF_MIN_STRATE,
  P75,
  TOLERANCE_CUMUL,
  ponderer,
  standardiserPart,
  verifierPonderation,
  type Couverture,
} from "@mip/stats/standardisation";
import { pool, q } from "./db";
import { queryOf, type Filters } from "./filters";
import { binder, compileScope, sessionJoin } from "./query-compiler";
import { contextFor, sqlContext, type SqlContext } from "./query-sql";
import { SANS_RELEASE } from "./releases";
import { type DeployImpact, type VersionRow } from "./deploys-verdict";
// Les décisions pures (verdict, référence, taux, écarts) et leurs types vivent dans
// `deploys-verdict.ts`, SANS la base ; réexportés ici.
export * from "./deploys-verdict";

export interface DeployRow {
  id: number;
  ts: Date | string;
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
  source: "ci" | "manual",
  ts?: Date,
): Promise<void> {
  // L'écriture est celle du collector (C11), partagée : `@mip/backend/lib/deploiements.mjs`.
  await enregistrerDeploiement(pool, { appId, version, env, ts: ts ?? null }, source);
}

/**
 * Impact du DERNIER déploiement : p75 LCP, volume de pages vues et de sessions,
 * occurrences d'erreurs JS sur les 2 h qui précèdent vs les 2 h qui suivent.
 * null si aucun déploiement.
 */
export async function latestDeployImpact(f: Filters): Promise<DeployImpact | null> {
  const query = queryOf(f);
  const { params, bind } = binder();
  // Mesures lues dans l'app DU marqueur : un déploiement de A ne juge pas le LCP de B.
  const [row] = await q<DeployImpact & { errors_before: number; errors_after: number }>(
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
       coalesce((select count(*) from rum_pageview p, d
          where p.app_id = d.app_id
            and p.started_at >= d.ts - interval '2 hours' and p.started_at < d.ts), 0)::int as pageviews_before,
       coalesce((select count(*) from rum_pageview p, d
          where p.app_id = d.app_id
            and p.started_at >= d.ts and p.started_at < d.ts + interval '2 hours'), 0)::int as pageviews_after,
       coalesce((select count(distinct p.session_id) from rum_pageview p, d
          where p.app_id = d.app_id
            and p.started_at >= d.ts - interval '2 hours' and p.started_at < d.ts), 0)::int as sessions_before,
       coalesce((select count(distinct p.session_id) from rum_pageview p, d
          where p.app_id = d.app_id
            and p.started_at >= d.ts and p.started_at < d.ts + interval '2 hours'), 0)::int as sessions_after,
       coalesce((select sum(e.occurrences) from rum_error e, d
          where e.app_id = d.app_id
            and e.ts >= d.ts - interval '2 hours' and e.ts < d.ts), 0)::int as errors_before,
       coalesce((select sum(e.occurrences) from rum_error e, d
          where e.app_id = d.app_id
            and e.ts >= d.ts and e.ts < d.ts + interval '2 hours'), 0)::int as errors_after`,
    params,
  );
  if (!row?.deploy_ts) return null;
  return {
    ...row,
    errors_before: row.pageviews_before === 0 ? null : row.errors_before,
    errors_after: row.pageviews_after === 0 ? null : row.errors_after,
  };
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

/** Libellé du groupe des mesures qui ne déclarent aucune release (défini dans lib/releases.ts, module feuille). */
export { SANS_RELEASE };

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
 *
 * Une lecture en échec LÈVE (F02) : elle rendait autrefois une comparaison vide,
 * que le tableau des versions prenait pour « moins de deux versions ». L'écran
 * l'enveloppe dans `lire()` et dit « Lecture en échec ».
 */
export async function comparaisonVersions(f: Filters, limit = 12): Promise<ComparaisonVersions> {
  const sql = await sqlContext(f);
  const parOccurrence =
    sql.schema.has("rum_pageview.release") && sql.schema.has("rum_metric.release") && sql.schema.has("rum_error.release");
  const rows = parOccurrence ? await parOccurrenceSql(sql, limit) : await parSessionSql(sql, limit);
  return { rows, source: parOccurrence ? "occurrence" : "session" };
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

// ─────────────────────── À mix de trafic égal (standardisation) ───────────────────────

/** Les découpages, en clair : l'écran les écrit tels quels. */
export const STRATES_VITAUX = "route × appareil";
export const STRATES_ERREURS = "route d'entrée × appareil";
/** Route ou appareil absent : une strate comme une autre, nommée. */
const INCONNU = "(inconnu)";

/** Une mesure à mix de trafic égal, ou la raison chiffrée de son silence (une ligne). */
export type LigneStandardisee =
  | {
      ok: true;
      a: number;
      b: number;
      couverture: Couverture;
      strates: { communes: number; total: number };
      effectifs: { a: number; b: number };
    }
  | { ok: false; raison: string };

export type ComparaisonStandardisee =
  | { disponible: false; raison: string }
  | {
      disponible: true;
      lcp: LigneStandardisee;
      inp: LigneStandardisee;
      erreurs: LigneStandardisee;
      /** Part des sessions de A, de B et des deux dans des strates communes (route d'entrée × appareil). */
      couvertureSessions: Couverture | null;
    };

export const RAISON_SANS_RELEASE_PAR_MESURE =
  "la release n'est pas portée par chaque mesure sur ce déploiement (migration v75) : aucune strate à comparer";

interface VitalParStrate {
  name: "LCP" | "INP";
  route: string;
  appareil: string;
  a: number;
  b: number;
  p75a: number | null;
  p75b: number | null;
}

interface SessionsParStrate {
  route: string;
  appareil: string;
  na: number;
  ka: number;
  nb: number;
  kb: number;
}

const cleStrate = (route: string, appareil: string) => `${route}\u0000${appareil}`;

/**
 * Les releases A et B À MIX DE TRAFIC ÉGAL : LCP et INP p75 standardisés par route ×
 * appareil, part de sessions en erreur par route d'entrée × appareil, et la couverture
 * (`@mip/stats/standardisation`, qui porte la méthode et ses seuils).
 *
 * MÊMES POPULATIONS QUE `comparaisonVersions` : mêmes cibles du compilateur (fenêtre,
 * périmètre, filtres, exclusion des robots), release lue sur chaque mesure — mais
 * BORNÉES AUX DEUX RELEASES comparées : on ne lit rien d'autre.
 *
 * LE p75 PONDÉRÉ SE CALCULE EN BASE (Neon se paie à l'usage) : les mesures ne quittent
 * pas PostgreSQL, seule la somme cumulée des poids les parcourt ; reviennent les
 * effectifs par strate (pour la couverture et les refus, calculés par le module) et
 * deux p75 par vital. Le calcul SQL est celui de `quantilePondere` — prouvé contre lui
 * par tests/integration/versions-standardisees-sql.test.ts.
 *
 * La route d'entrée d'une session, pour une release, est celle de sa PREMIÈRE page vue
 * sous cette release (une session à cheval sur un déploiement entre dans B là où B
 * l'a reçue). Une lecture en échec LÈVE : le chargeur l'enveloppe dans `section()`.
 */
export async function comparaisonStandardisee(f: Filters, relA: string, relB: string): Promise<ComparaisonStandardisee> {
  const sql = await sqlContext(f);
  const parOccurrence =
    sql.schema.has("rum_pageview.release") && sql.schema.has("rum_metric.release") && sql.schema.has("rum_error.release");
  if (!parOccurrence) return { disponible: false, raison: RAISON_SANS_RELEASE_PAR_MESURE };
  const [vitaux, sessions] = await Promise.all([
    vitauxParStrate(sql, relA, relB),
    sessionsParStrate(contextFor(sql.query, sql.schema), relA, relB),
  ]);

  const ligneVitale = (nom: VitalParStrate["name"]): LigneStandardisee => {
    const lignes = vitaux.filter((r) => r.name === nom);
    const p = ponderer(
      lignes.map((r) => ({ strate: cleStrate(r.route, r.appareil), a: r.a, b: r.b })),
      EFFECTIF_MIN_STRATE,
    );
    const refus = verifierPonderation(p, "mesures", STRATES_VITAUX);
    if (refus) return { ok: false, raison: refus.raison };
    const p75a = lignes[0]?.p75a;
    const p75b = lignes[0]?.p75b;
    if (p75a == null || p75b == null || !p.couverture) return { ok: false, raison: "p75 pondéré non calculé" };
    return { ok: true, a: Number(p75a), b: Number(p75b), couverture: p.couverture, strates: p.nbStrates, effectifs: p.effectifs };
  };

  const effectifsSessions = sessions.map((r) => ({
    strate: cleStrate(r.route, r.appareil),
    a: { n: r.na, k: r.ka },
    b: { n: r.nb, k: r.kb },
  }));
  const part = standardiserPart(effectifsSessions, { unite: "sessions", strates: STRATES_ERREURS });
  const erreurs: LigneStandardisee =
    part.ok && part.ponderation.couverture
      ? {
          ok: true,
          a: part.a,
          b: part.b,
          couverture: part.ponderation.couverture,
          strates: part.ponderation.nbStrates,
          effectifs: part.ponderation.effectifs,
        }
      : { ok: false, raison: part.ok ? "part pondérée non calculée" : part.raison };
  const couvertureSessions = ponderer(
    effectifsSessions.map((l) => ({ strate: l.strate, a: l.a.n, b: l.b.n })),
    EFFECTIF_MIN_STRATE,
  ).couverture;

  return { disponible: true, lcp: ligneVitale("LCP"), inp: ligneVitale("INP"), erreurs, couvertureSessions };
}

/**
 * LCP et INP de A et B par route × appareil, et leurs p75 pondérés. Poids d'une
 * mesure de la release r dans la strate s : (N_s / N) ÷ (n_rs / n_r), sur les strates
 * où CHAQUE release compte au moins `EFFECTIF_MIN_STRATE` mesures ; p75 = plus petite
 * valeur dont la somme cumulée des poids atteint 75 % du total (tolérance relative
 * `TOLERANCE_CUMUL`, la même que le module).
 */
async function vitauxParStrate(sql: SqlContext, relA: string, relB: string): Promise<VitalParStrate[]> {
  const mesures = sql.where({ dataset: "vitals", row: "x", session: "ms", time: "x.ts" });
  const sans = sql.bind(SANS_RELEASE);
  const inconnu = sql.bind(INCONNU);
  const a = sql.bind(relA);
  const b = sql.bind(relB);
  const min = sql.bind(EFFECTIF_MIN_STRATE);
  const p = sql.bind(P75);
  const tol = sql.bind(TOLERANCE_CUMUL);
  return q<VitalParStrate>(
    `with m as (
       select coalesce(nullif(x.release, ''), ${sans}) as rel, x.name,
              coalesce(nullif(x.route, ''), ${inconnu}) as route,
              coalesce(nullif(ms.device_type, ''), ${inconnu}) as appareil,
              x.value
         from rum_metric x
         ${sessionJoin("x", "ms")}
        where x.name in ('LCP', 'INP')${mesures}
          and coalesce(nullif(x.release, ''), ${sans}) in (${a}, ${b})
     ),
     s as (
       select name, route, appareil,
              count(*) filter (where rel = ${a})::int as a,
              count(*) filter (where rel = ${b})::int as b
         from m
        group by 1, 2, 3
     ),
     c as (
       select name, route, appareil, a, b,
              (a + b)::float8 / (sum(a + b) over (partition by name))::float8 as part_ref,
              (sum(a) over (partition by name))::float8 as na,
              (sum(b) over (partition by name))::float8 as nb
         from s
        where a >= ${min} and b >= ${min}
     ),
     w as (
       select name, route, appareil, ${a}::text as rel, part_ref / (a::float8 / na) as poids from c
       union all
       select name, route, appareil, ${b}::text as rel, part_ref / (b::float8 / nb) as poids from c
     ),
     o as (
       select m.name, m.rel, m.value,
              sum(w.poids) over (partition by m.name, m.rel order by m.value rows between unbounded preceding and current row) as cumul,
              sum(w.poids) over (partition by m.name, m.rel) as total
         from m
         join w on w.name = m.name and w.route = m.route and w.appareil = m.appareil and w.rel = m.rel
     ),
     qp as (
       select name,
              min(value) filter (where rel = ${a} and cumul >= ${p}::float8 * total - ${tol}::float8 * total) as p75a,
              min(value) filter (where rel = ${b} and cumul >= ${p}::float8 * total - ${tol}::float8 * total) as p75b
         from o
        group by name
     )
     select s.name, s.route, s.appareil, s.a, s.b, qp.p75a, qp.p75b
       from s
       left join qp on qp.name = s.name
      order by s.name, s.a + s.b desc, s.route, s.appareil`,
    sql.params,
  );
}

/**
 * Sessions de A et B par route d'entrée × appareil, et celles qui portent au moins
 * une erreur SOUS LA MÊME release (une session en erreur est une session de la
 * strate : k ≤ n). Session = (app, session), comme le dénominateur de `comparaisonVersions`.
 */
async function sessionsParStrate(sql: SqlContext, relA: string, relB: string): Promise<SessionsParStrate[]> {
  const vues = sql.where({ dataset: "views", row: "p", session: "ps", time: "p.started_at" });
  const erreurs = sql.where({ dataset: "errors", row: "x", session: "es", time: "x.ts" });
  const sans = sql.bind(SANS_RELEASE);
  const inconnu = sql.bind(INCONNU);
  const a = sql.bind(relA);
  const b = sql.bind(relB);
  return q<SessionsParStrate>(
    `with pv as (
       select coalesce(nullif(p.release, ''), ${sans}) as rel, p.app_id, p.session_id, p.route,
              ps.device_type, p.started_at, p.id
         from rum_pageview p
         ${sessionJoin("p", "ps")}
        where true${vues}
          and coalesce(nullif(p.release, ''), ${sans}) in (${a}, ${b})
     ),
     v as (
       select distinct on (rel, app_id, session_id)
              rel, app_id, session_id,
              coalesce(nullif(route, ''), ${inconnu}) as route,
              coalesce(nullif(device_type, ''), ${inconnu}) as appareil
         from pv
        order by rel, app_id, session_id, started_at, id
     ),
     e as (
       select distinct coalesce(nullif(x.release, ''), ${sans}) as rel, x.app_id, x.session_id
         from rum_error x
         ${sessionJoin("x", "es")}
        where true${erreurs}
          and coalesce(nullif(x.release, ''), ${sans}) in (${a}, ${b})
     )
     select v.route, v.appareil,
            count(*) filter (where v.rel = ${a})::int as na,
            count(*) filter (where v.rel = ${a} and e.session_id is not null)::int as ka,
            count(*) filter (where v.rel = ${b})::int as nb,
            count(*) filter (where v.rel = ${b} and e.session_id is not null)::int as kb
       from v
       left join e on e.rel = v.rel and e.app_id = v.app_id and e.session_id = v.session_id
      group by 1, 2
      order by count(*) desc, 1, 2`,
    sql.params,
  );
}
