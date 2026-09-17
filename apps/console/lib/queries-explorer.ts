// Exécution de la requête analytique (P6.4) — couche I/O. La validation vit dans
// `analytics-schema.ts`, le SQL dans `analytics-compiler.ts` ; ce module ne fait
// que les exécuter et mettre en forme la réponse.
//
// UN SEUL INSTANTANÉ. Total, groupes, tendance et journal tournent dans UNE
// transaction `repeatable read read only` : une ingestion concurrente ne peut pas
// faire dire au total autre chose qu'aux groupes. Le journal paginé est la seule
// lecture qui connaît le curseur ; il n'alimente jamais un graphe.
//
// UN BUDGET. `statement_timeout` est posé en `SET LOCAL` — donc rendu avec la
// transaction, jamais fuité vers la requête suivante par le pooler. Au-delà, la
// lecture échoue en `query_budget_exceeded` : l'Explorer dit qu'il n'a pas pu
// répondre, il ne rend jamais une série de zéros qu'on prendrait pour du calme.
import {
  ExplorerBudgetError,
  UnsupportedExplorerDimension,
  canonicalAst,
  datasetDefinition,
  estAdditive,
  explorerFingerprint,
  encodeExplorerCursor,
  mesureNumerique,
  publicSchema,
  type ExplorerPlan,
  type ExplorerRequest,
  type PublicSchema,
} from "./analytics-schema";
import {
  COLONNE_PREFIXE,
  compileGroups,
  compileRows,
  compileSeries,
  compileTotal,
  type CompiledSql,
  type GroupRow,
  type JournalRow,
  type SeriesRow,
  type TotalRow,
} from "./analytics-compiler";
import { tx } from "./db";
import { dimensionSupport, type DatasetId } from "./query-compiler";
import type { AnalyticsQuery, Dimension, Parsed } from "./query-contract";
import { contextFor } from "./query-sql";
import { dimensionSchema } from "./query-schema";

/**
 * Budget par défaut d'une lecture d'Explorer. Objectif de travail, pas un SLA :
 * P6.6 le mesurera sur base représentative et l'ajustera avec ses preuves.
 */
export const EXPLORER_TIMEOUT_MS = 5_000;

/** Rétention de la purge d'ingestion : au-delà, la fenêtre demandée n'est plus couverte. */
function retentionDays(): number {
  const n = Number(process.env.RETENTION_DAYS || 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export interface ExplorerGroup {
  /** Tuple JSON, jamais une concaténation : une valeur peut contenir n'importe quel séparateur. */
  key: Array<string | null>;
  value: number | null;
  samples: number;
}

export interface ExplorerPoint extends ExplorerGroup {
  start: string;
  end: string;
}

export interface ExplorerMeta {
  query_version: number;
  effective_apps: string[] | null;
  range: { from: string; to: string; preset: string | null; bucket_seconds: number };
  dataset: string;
  measure: string;
  unit: string;
  aggregation: string;
  additive: boolean;
  /** Ce qui est compté, en toutes lettres. */
  counting: string;
  /** `raw` : lecture brute. Les agrégats pré-calculés viendront avec P6.6. */
  source: "raw";
  group_by: Dimension[];
  visualization: string;
  warnings: string[];
  coverage: { status: "complete" | "partial" | "unknown"; reason: string | null };
  truncated_groups: boolean;
  /** AST canonique rejouable — ce qu'un tableau de bord enregistrera (P6.5). */
  query: Record<string, unknown>;
}

export interface ExplorerData {
  total: number | null;
  samples: number;
  groups: ExplorerGroup[];
  series: ExplorerPoint[];
  rows: Array<Record<string, unknown>>;
  next_cursor: string | null;
}

export interface ExplorerResult {
  meta: ExplorerMeta;
  data: ExplorerData;
}

/** `57014` : instruction annulée par `statement_timeout`. */
function estDelaiDepasse(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "57014";
}

function nombre(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Avertissements de la requête : ce que la mesure ne dit pas. Ils restent même
 * quand le stockage est complet — un échantillonnage biaisé n'est pas un trou de
 * couverture, c'est une limite de ce qui a été collecté.
 */
function avertissements(plan: ExplorerPlan): string[] {
  const definition = datasetDefinition(plan.dataset);
  const field = definition.fields[plan.measure.field];
  const sorties = [...definition.notices];
  if (field.notice) sorties.push(field.notice);
  if (definition.variant && !definition.variant.required && plan.variant === null && definition.variant.mixedNotice) {
    sorties.push(definition.variant.mixedNotice);
  }
  return sorties;
}

function couverture(query: AnalyticsQuery): ExplorerMeta["coverage"] {
  const horizon = Date.parse(query.range.to) - retentionDays() * 86_400_000;
  if (Date.parse(query.range.from) >= horizon) return { status: "complete", reason: null };
  return {
    status: "partial",
    reason: `La fenêtre demandée remonte au-delà de la rétention (${retentionDays()} jours) : les données les plus anciennes ont été purgées.`,
  };
}

/** Lignes du journal : les colonnes déclarées, rendues sous leur identifiant public. */
function journal(plan: ExplorerPlan, rows: JournalRow[]): Array<Record<string, unknown>> {
  const colonnes = datasetDefinition(plan.dataset).rows;
  return rows.map((row) => {
    const sortie: Record<string, unknown> = {};
    for (const colonne of colonnes) sortie[colonne.id] = row[`${COLONNE_PREFIXE}${colonne.id}`] ?? null;
    return sortie;
  });
}

export interface ExplorerOptions {
  /** Budget de l'instruction, en millisecondes. Les tests en imposent un très court. */
  timeoutMs?: number;
}

/**
 * Exécute une requête déjà validée. Les erreurs de dimension non portée
 * remontent typées (400) ; un dépassement de budget remonte en
 * `ExplorerBudgetError` (503).
 */
export async function exploreAnalytics(
  request: ExplorerRequest,
  options: ExplorerOptions = {},
): Promise<ExplorerResult> {
  const { query, plan } = request;
  const schema = await dimensionSchema();
  const definition = datasetDefinition(plan.dataset);
  const field = definition.fields[plan.measure.field];
  const additive = estAdditive(plan.measure.aggregation);
  const budget = options.timeoutMs ?? EXPLORER_TIMEOUT_MS;

  // Chaque instruction lie ses propres paramètres : une requête ne déclare que
  // les `$n` qu'elle utilise, sur la même requête résolue et le même schéma.
  const compile = (compiler: (ctx: ReturnType<typeof contextFor>, plan: ExplorerPlan) => Parsed<CompiledSql>) => {
    const compiled = compiler(contextFor(query, schema), plan);
    if (!compiled.ok) throw new UnsupportedExplorerDimension(compiled.error.message, compiled.error.dimension);
    return compiled.value;
  };

  const total = compile(compileTotal);
  const groupes = plan.visualization === "toplist" || plan.visualization === "timeseries" ? compile(compileGroups) : null;
  const serie = plan.visualization === "timeseries" ? compile(compileSeries) : null;
  const lignes = plan.visualization === "table" ? compile(compileRows) : null;

  const lu = await tx(async (client) => {
    // Une seule photographie et une seule horloge pour les quatre lectures.
    await client.query("set transaction isolation level repeatable read read only");
    // `SET LOCAL` : rendu avec la transaction. Un `set` de session fuirait le
    // budget vers la requête suivante qui réutilise la même connexion du pool.
    await client.query(`set local statement_timeout = ${Number(budget)}`);
    const run = async <T>(sql: CompiledSql | null): Promise<T[]> =>
      sql ? ((await client.query(sql.text, sql.params)).rows as T[]) : [];
    return {
      total: await run<TotalRow>(total),
      groupes: await run<GroupRow>(groupes),
      serie: await run<SeriesRow>(serie),
      lignes: await run<JournalRow>(lignes),
    };
  }).catch((error: unknown) => {
    if (estDelaiDepasse(error)) throw new ExplorerBudgetError();
    throw error;
  });

  let approx = false;
  const valeurDe = (raw: unknown): number | null => {
    const mesure = mesureNumerique(raw);
    approx ||= mesure.approx;
    return mesure.value;
  };

  const totalRow = lu.total[0];
  // Un dénombrement réellement vide vaut 0 ; une moyenne ou un percentile sans
  // échantillon vaut null. Les deux sont des réponses, pas des absences.
  const totalValeur = totalRow ? (valeurDe(totalRow.valeur) ?? (additive ? 0 : null)) : additive ? 0 : null;

  const tronque = lu.groupes.length > plan.limit;
  const groups: ExplorerGroup[] = lu.groupes.slice(0, plan.limit).map((row) => ({
    key: cle(plan, row),
    value: valeurDe(row.valeur),
    samples: nombre(row.samples),
  }));

  const largeur = query.range.bucketSeconds * 1000;
  const series: ExplorerPoint[] = lu.serie.map((row) => {
    const start = new Date(row.bucket).getTime();
    return {
      start: new Date(start).toISOString(),
      end: new Date(start + largeur).toISOString(),
      key: cle(plan, row),
      value: valeurDe(row.valeur),
      samples: nombre(row.samples),
    };
  });

  const rows = journal(plan, lu.lignes);
  const derniere = lu.lignes.length === plan.limit ? lu.lignes.at(-1) : undefined;

  const warnings = avertissements(plan);
  if (approx) {
    warnings.push(
      "Une valeur dépasse l'entier exact de JavaScript : le nombre rendu est approché, il n'est pas arrondi en silence.",
    );
  }

  return {
    meta: {
      query_version: plan.version,
      effective_apps: query.scope.effectiveApps,
      range: {
        from: query.range.from,
        to: query.range.to,
        preset: query.range.preset,
        bucket_seconds: query.range.bucketSeconds,
      },
      dataset: plan.dataset,
      measure: plan.measure.field,
      unit: field.unit,
      aggregation: plan.measure.aggregation,
      additive,
      counting: definition.population,
      source: "raw",
      group_by: plan.groupBy,
      visualization: plan.visualization,
      warnings,
      coverage: couverture(query),
      truncated_groups: tronque,
      query: canonicalAst(query, plan),
    },
    data: {
      total: totalValeur,
      samples: nombre(totalRow?.samples),
      groups,
      series,
      rows,
      next_cursor: derniere
        ? encodeExplorerCursor({
            fingerprint: explorerFingerprint(query, plan),
            ts: derniere.cursor_ts,
            key: String(derniere.cursor_key),
          })
        : null,
    },
  };
}

/** Clé de groupe : un TUPLE, aussi long que le regroupement demandé. */
function cle(plan: ExplorerPlan, row: GroupRow): Array<string | null> {
  return plan.groupBy.map((_, index) => (index === 0 ? row.g0 : row.g1));
}

/**
 * Registre public des capacités : jeux, mesures, dimensions réellement
 * disponibles et limites. Il ne publie ni table, ni colonne, ni valeur client —
 * un inventaire de valeurs révélerait les releases d'un tenant à un autre.
 */
export async function explorerSchema(capabilities: { saveToDashboard: boolean }): Promise<PublicSchema> {
  const schema = await dimensionSchema();
  return publicSchema((dataset: DatasetId, dimension: Dimension) => {
    const support = dimensionSupport(dataset, dimension, schema);
    return support.supported ? { available: true, reason: null } : { available: false, reason: support.message };
  }, capabilities);
}
