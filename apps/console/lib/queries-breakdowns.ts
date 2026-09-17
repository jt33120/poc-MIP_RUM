// Découpages prêts à l'emploi (P6.3) — couche I/O.
//
// Une seule forme de résultat pour tous les onglets : des GROUPES bornés, leur
// nombre réel, et « Inconnu » compté à part. La colonne de regroupement vient
// EXCLUSIVEMENT du registre du compilateur (`dimensionSupport`), jamais d'une
// chaîne d'URL ; la fenêtre, le périmètre et les filtres viennent du contrat
// commun P6.2 en paramètres liés.
import { q } from "./db";
import { BREAKDOWN_CAP, type BreakdownDimension } from "./breakdowns";
import type { FiltersLike } from "./filters";
import { dimensionSupport, sessionJoin, unsupportedError, UnsupportedFilterError, type DatasetId } from "./query-compiler";
import { sqlContext, type SqlContext } from "./query-sql";

/** Jeux de données découpés par l'accueil et `/pages` : les Web Vitals. */
export const VITALS_BREAKDOWN_DATASETS = ["vitals"] as const satisfies readonly DatasetId[];
/** Jeu de données découpé par `/errors` : les occurrences d'erreurs. */
export const ERRORS_BREAKDOWN_DATASETS = ["errors"] as const satisfies readonly DatasetId[];

export interface BreakdownResult<T> {
  rows: T[];
  /** Nombre RÉEL de groupes sur la fenêtre, avant plafonnement. */
  groups: number;
  /** Des groupes existent au-delà de ceux rendus. */
  truncated: boolean;
}

export interface VitalsBreakdownRow {
  /** Valeur de la dimension ; `null` = inconnu (jamais une chaîne). */
  valeur: string | null;
  /** Mesures LCP + INP + CLS du groupe : l'échantillon sur lequel se lisent les p75. */
  samples: number;
  lcp_n: number;
  inp_n: number;
  cls_n: number;
  lcp_p75: number | null;
  inp_p75: number | null;
  cls_p75: number | null;
}

export interface ErrorsBreakdownRow {
  valeur: string | null;
  /** Occurrences reçues (somme des répétitions), pas un nombre de lignes. */
  occurrences: number;
  /** Sessions DE LA MÊME APP touchées ; une erreur backend n'en a pas. */
  sessions: number;
  /** Signatures distinctes dans le groupe. */
  signatures: number;
}

/**
 * Colonne de regroupement d'une dimension : son alias et son nom viennent du
 * registre fermé. Une dimension que le jeu de données ne porte pas, ou dont la
 * colonne n'existe pas encore, lève l'erreur typée du contrat — jamais un
 * classement calculé en ignorant la dimension demandée.
 */
function groupColumn(dataset: DatasetId, dimension: BreakdownDimension, sql: SqlContext, row: string, session: string): string {
  const support = dimensionSupport(dataset, dimension, sql.schema);
  if (!support.supported) throw new UnsupportedFilterError(unsupportedError(dimension, support.message));
  return `${support.source.on === "row" ? row : session}.${support.source.column}`;
}

/** `groupes` est le nombre RÉEL de groupes, rendu par une fenêtre sur chaque ligne : il sort du résultat. */
function resultOf<T>(rows: (T & { groupes: number })[]): BreakdownResult<T> {
  const groups = rows[0]?.groupes ?? 0;
  return {
    rows: rows.map(({ groupes: _ignore, ...rest }) => rest as unknown as T),
    groups,
    truncated: groups > rows.length,
  };
}

/**
 * Web Vitals découpés par dimension : nombre de mesures et p75 LCP / INP / CLS.
 *
 * Seules les trois mesures affichées entrent dans l'échantillon : compter aussi
 * FCP et TTFB gonflerait un « nombre d'échantillons » que les trois colonnes ne
 * justifient pas. Un p75 sans mesure reste `null` — « pas de mesure », jamais 0.
 */
export async function vitalsBreakdown(
  f: FiltersLike,
  dimension: BreakdownDimension,
  cap = BREAKDOWN_CAP,
): Promise<BreakdownResult<VitalsBreakdownRow>> {
  const sql = await sqlContext(f);
  const colonne = groupColumn("vitals", dimension, sql, "m", "s");
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const rows = await q<VitalsBreakdownRow & { groupes: number }>(
    `with groupes as (
       select ${colonne} as valeur,
              count(*)::int as samples,
              count(*) filter (where m.name = 'LCP')::int as lcp_n,
              count(*) filter (where m.name = 'INP')::int as inp_n,
              count(*) filter (where m.name = 'CLS')::int as cls_n,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as lcp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as inp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'CLS') as cls_p75
         from rum_metric m
         ${sessionJoin("m", "s")}
        where m.name in ('LCP', 'INP', 'CLS')${where}
        group by 1
     )
     select valeur, samples, lcp_n, inp_n, cls_n, lcp_p75, inp_p75, cls_p75, count(*) over ()::int as groupes
       from groupes
      order by samples desc, valeur asc nulls last
      limit ${Number(cap)}`,
    sql.params,
  );
  return resultOf(rows);
}

/**
 * Occurrences d'erreurs découpées par dimension : occurrences reçues, sessions
 * touchées et signatures distinctes.
 *
 * `sum(occurrences)` et non un comptage de lignes : le SDK déduplique une erreur
 * qui se répète et joint le nombre de répétitions tues. Les trois colonnes sont
 * des populations DIFFÉRENTES et ne s'additionnent pas entre elles.
 */
export async function errorsBreakdown(
  f: FiltersLike,
  dimension: BreakdownDimension,
  cap = BREAKDOWN_CAP,
): Promise<BreakdownResult<ErrorsBreakdownRow>> {
  const sql = await sqlContext(f);
  const colonne = groupColumn("errors", dimension, sql, "e", "s");
  const where = sql.where({ dataset: "errors", row: "e", session: "s", time: "e.ts" });
  const rows = await q<ErrorsBreakdownRow & { groupes: number }>(
    `with groupes as (
       select ${colonne} as valeur,
              coalesce(sum(e.occurrences), 0)::float8 as occurrences,
              count(distinct s.session_id)::int as sessions,
              count(distinct e.fingerprint)::int as signatures
         from rum_error e
         ${sessionJoin("e", "s")}
        where true${where}
        group by 1
     )
     select valeur, occurrences, sessions, signatures, count(*) over ()::int as groupes
       from groupes
      order by occurrences desc, valeur asc nulls last
      limit ${Number(cap)}`,
    sql.params,
  );
  return resultOf(rows);
}
