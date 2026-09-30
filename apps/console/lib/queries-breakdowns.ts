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
import { SEUIL_RANGS_NORMAUX, Z95, intervalleP75Lu, rangsQuantileNormalSql, type IntervalleP75 } from "@mip/stats/incertitude";

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
  /**
   * Intervalle à 95 % de chaque p75 du groupe (P*.1), par la méthode des tuiles :
   * un classement qui affirme « À améliorer » sur 312 ms alors que la tuile dit
   * « verdict incertain » pour la même population se contredit (recette du 26/09/2026).
   */
  lcp_intervalle: IntervalleP75;
  inp_intervalle: IntervalleP75;
  cls_intervalle: IntervalleP75;
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
 * Web Vitals découpés par dimension : nombre de mesures, p75 LCP / INP / CLS et
 * l'intervalle à 95 % de chaque p75.
 *
 * Seules les trois mesures affichées entrent dans l'échantillon : compter aussi
 * FCP et TTFB gonflerait un « nombre d'échantillons » que les trois colonnes ne
 * justifient pas. Un p75 sans mesure reste `null` — « pas de mesure », jamais 0.
 *
 * L'intervalle suit la règle de `vitalsP75` (la tuile) : mesures triées sous 30
 * (rangs exacts, en JS), statistiques d'ordre aux rangs normaux au-delà, par la
 * même formule SQL (`rangsQuantileNormalSql`). Les statistiques d'ordre se lisent
 * dans le tableau trié du groupe plutôt que par une fenêtre `row_number` : même
 * rang, même valeur, en un seul balayage — le découpage en fait trois par écran.
 */
export async function vitalsBreakdown(
  f: FiltersLike,
  dimension: BreakdownDimension,
  cap = BREAKDOWN_CAP,
): Promise<BreakdownResult<VitalsBreakdownRow>> {
  const sql = await sqlContext(f);
  const colonne = groupColumn("vitals", dimension, sql, "m", "s");
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const seuil = sql.bind(SEUIL_RANGS_NORMAUX);
  const z = sql.bind(Z95);
  const bornes = (v: "lcp" | "inp" | "cls") => {
    const rangs = rangsQuantileNormalSql(`${v}_n`, z);
    return `case when ${v}_n < ${seuil}::int then ${v}_tri end as ${v}_valeurs,
            case when ${v}_n >= ${seuil}::int then ${v}_tri[${rangs.r}] end as ${v}_bas,
            case when ${v}_n >= ${seuil}::int then ${v}_tri[${rangs.s}] end as ${v}_haut`;
  };
  type Lue = Omit<VitalsBreakdownRow, "lcp_intervalle" | "inp_intervalle" | "cls_intervalle"> & {
    groupes: number;
  } & Record<`${"lcp" | "inp" | "cls"}_${"valeurs"}`, number[] | null> &
    Record<`${"lcp" | "inp" | "cls"}_${"bas" | "haut"}`, number | null>;
  const rows = await q<Lue>(
    `with groupes as (
       select ${colonne} as valeur,
              count(*)::int as samples,
              count(*) filter (where m.name = 'LCP')::int as lcp_n,
              count(*) filter (where m.name = 'INP')::int as inp_n,
              count(*) filter (where m.name = 'CLS')::int as cls_n,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'LCP') as lcp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'INP') as inp_p75,
              percentile_cont(0.75) within group (order by m.value) filter (where m.name = 'CLS') as cls_p75,
              array_agg(m.value order by m.value) filter (where m.name = 'LCP') as lcp_tri,
              array_agg(m.value order by m.value) filter (where m.name = 'INP') as inp_tri,
              array_agg(m.value order by m.value) filter (where m.name = 'CLS') as cls_tri
         from rum_metric m
         ${sessionJoin("m", "s")}
        where m.name in ('LCP', 'INP', 'CLS')${where}
        group by 1
     )
     select valeur, samples, lcp_n, inp_n, cls_n, lcp_p75, inp_p75, cls_p75,
            ${bornes("lcp")},
            ${bornes("inp")},
            ${bornes("cls")},
            count(*) over ()::int as groupes
       from groupes
      order by samples desc, valeur asc nulls last
      limit ${Number(cap)}`,
    sql.params,
  );
  return resultOf<VitalsBreakdownRow>(
    rows.map(({ lcp_valeurs, lcp_bas, lcp_haut, inp_valeurs, inp_bas, inp_haut, cls_valeurs, cls_bas, cls_haut, ...r }) => ({
      ...r,
      lcp_intervalle: intervalleP75Lu(r.lcp_n, lcp_valeurs, lcp_bas, lcp_haut),
      inp_intervalle: intervalleP75Lu(r.inp_n, inp_valeurs, inp_bas, inp_haut),
      cls_intervalle: intervalleP75Lu(r.cls_n, cls_valeurs, cls_bas, cls_haut),
    })),
  );
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
