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
//
// DEUX CHEMINS (P6.6). Par défaut, les lignes brutes. Quand un agrégat pré-calculé
// porte TOUTES les dimensions demandées et exactement la même population, la
// lecture devient hybride : l'agrégat pour les heures entières déjà consolidées,
// le brut pour le reste. `meta.source` dit lequel a répondu, `meta.approximate`
// si la valeur vient d'une distribution en seaux, et `meta.rollup.reason` POURQUOI
// l'agrégat n'a pas servi — jamais un silence.
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
  compileRollupHistogram,
  compileRows,
  compileSeries,
  compileTotal,
  type CompiledSql,
  type GroupRow,
  type HistogrammeRow,
  type JournalRow,
  type SeriesRow,
  type TotalRow,
} from "./analytics-compiler";
import {
  chooseRollup,
  effectif,
  hybrideDisponible,
  percentileFusionne,
  type RollupSource,
} from "./analytics-rollups";
import { tx } from "./db";
import { dimensionSupport, type DatasetId } from "./query-compiler";
import type { AnalyticsQuery, Dimension, Parsed } from "./query-contract";
import { contextFor } from "./query-sql";
import { dimensionSchema } from "./query-schema";

/**
 * Budget par défaut d'une lecture d'Explorer.
 *
 * MESURÉ, pas supposé (P6.6). Base jetable PostgreSQL 15 de 738 Mio — 1,2 M
 * d'événements sur 7 jours répartis 1 M / 150 k / 50 k entre trois apps, 600 k
 * Web Vitals, 400 k vues, 250 k erreurs, 120 k sessions dont 6 % de robots. Sur
 * 20 tirages à chaud, la lecture la plus lourde (série temporelle 7 jours,
 * filtre d'environnement, regroupement par release) tient à 947 ms en médiane et
 * 987 ms au p95 — sous l'objectif de test de 2 s. Les autres scénarios vont de
 * 29 ms (fenêtre de 24 h avec filtre sélectif) à 356 ms. Protocole et chiffres
 * complets : `tests/integration/explorer-bench-p66.test.ts` et l'en-tête de
 * `apps/ingest/sql/migration-v80.sql`.
 *
 * Le budget RESTE à 5 s après mesure, et ce n'est pas un oubli : il laisse un
 * facteur cinq pour un cache froid, un hôte plus lent ou un parc plus gros. Le
 * descendre échangerait une réponse lente contre une erreur, alors que la marge
 * mesurée n'a jamais été entamée. Objectif de travail, jamais un SLA de production.
 */
export const EXPLORER_TIMEOUT_MS = 5_000;

/** Origine de la mesure rendue, annoncée dans `meta.source`. */
export type ExplorerSource = "raw" | "rollup+raw";

/** Rétention de la purge d'ingestion : au-delà, la fenêtre demandée n'est plus couverte. */
export function retentionDays(): number {
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
  /**
   * App DEMANDÉE (ou « all »), comme dans l'enveloppe commune. L'Explorer ne
   * substitue jamais une app à une autre — il refuse (403) —, mais publier ce
   * champ garde les lecteurs génériques (rendu MCP, clients) sur un seul modèle.
   */
  app: string;
  period: string;
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
  /** `raw` : tout vient des lignes. `rollup+raw` : agrégat consolidé + complément brut. */
  source: ExplorerSource;
  /**
   * `true` : la valeur vient d'une distribution en seaux, donc approchée à la
   * largeur de seau près. Jamais tue, jamais présentée comme exacte.
   */
  approximate: boolean;
  /** L'agrégat a-t-il pu servir, et sinon pourquoi — en toutes lettres. */
  rollup: { eligible: boolean; source: string | null; reason: string | null };
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

/**
 * La fenêtre [from, to) tient-elle dans la rétention ? Partagée par l'Explorer et
 * par la comparaison à la période précédente (lib/comparaison.ts, F06) : une seule
 * règle de purge, lue au même endroit. `jours` n'est passé que par les tests.
 *
 * `ancreMs` : l'instant depuis lequel la purge compte. La purge part de MAINTENANT
 * (`apps/ingest/purge.mjs`) ; la comparaison passe donc son horloge. Par défaut
 * `range.to`, le comportement historique de l'Explorer (inchangé ici).
 */
export function couvertureRetention(
  query: AnalyticsQuery,
  jours = retentionDays(),
  ancreMs = Date.parse(query.range.to),
): ExplorerMeta["coverage"] {
  const horizon = ancreMs - jours * 86_400_000;
  if (Date.parse(query.range.from) >= horizon) return { status: "complete", reason: null };
  return {
    status: "partial",
    reason: `La fenêtre demandée remonte au-delà de la rétention (${jours} jours) : les données les plus anciennes ont été purgées.`,
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

/** Exécute une ou plusieurs instructions dans UNE transaction bornée en temps. */
type Executeur = <T>(sql: CompiledSql | null) => Promise<T[]>;

async function sousBudget<T>(budget: number, fn: (run: Executeur) => Promise<T>): Promise<T> {
  return tx(async (client) => {
    // Une seule photographie et une seule horloge pour toutes les lectures.
    await client.query("set transaction isolation level repeatable read read only");
    // `SET LOCAL` : rendu avec la transaction. Un `set` de session fuirait le
    // budget vers la requête suivante qui réutilise la même connexion du pool.
    await client.query(`set local statement_timeout = ${Number(budget)}`);
    return fn(async (sql) => (sql ? (await client.query(sql.text, sql.params)).rows : []));
  }).catch((error: unknown) => {
    if (estDelaiDepasse(error)) throw new ExplorerBudgetError();
    throw error;
  });
}

async function lireSous<T>(budget: number, sql: CompiledSql): Promise<T[]> {
  return sousBudget(budget, (run) => run<T>(sql));
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
  const additive = estAdditive(plan.measure.aggregation);
  const budget = options.timeoutMs ?? EXPLORER_TIMEOUT_MS;

  // Chaque instruction lie ses propres paramètres : une requête ne déclare que
  // les `$n` qu'elle utilise, sur la même requête résolue et le même schéma.
  const compile = (compiler: (ctx: ReturnType<typeof contextFor>, plan: ExplorerPlan) => Parsed<CompiledSql>) => {
    const compiled = compiler(contextFor(query, schema), plan);
    if (!compiled.ok) throw new UnsupportedExplorerDimension(compiled.error.message, compiled.error.dimension);
    return compiled.value;
  };

  // L'agrégat D'ABORD : s'il répond, il remplace total ET groupes, et la lecture
  // brute n'est même pas compilée. S'il ne répond pas, la RAISON est rendue.
  const decision = chooseRollup(plan, query);
  const disponible = decision.usable && hybrideDisponible(schema);
  const etatAgregat: ExplorerMeta["rollup"] = decision.usable
    ? {
        eligible: disponible,
        source: decision.source.id,
        reason: disponible ? null : "l'agrégat n'existe pas encore dans ce schéma (migration v80 non appliquée)",
      }
    : { eligible: false, source: null, reason: decision.reason };

  if (disponible && decision.usable) {
    const sql = compile((ctx, p) => compileRollupHistogram(ctx, p, decision.source));
    const lignes = await lireSous<HistogrammeRow>(budget, sql);
    return rendreHybride(request, decision.source, lignes, etatAgregat);
  }

  const total = compile(compileTotal);
  const groupes = plan.visualization === "toplist" || plan.visualization === "timeseries" ? compile(compileGroups) : null;
  const serie = plan.visualization === "timeseries" ? compile(compileSeries) : null;
  const lignes = plan.visualization === "table" ? compile(compileRows) : null;

  const lu = await sousBudget(budget, async (run) => ({
    total: await run<TotalRow>(total),
    groupes: await run<GroupRow>(groupes),
    serie: await run<SeriesRow>(serie),
    lignes: await run<JournalRow>(lignes),
  }));

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
    meta: metaCommune(request, {
      source: "raw",
      approximate: false,
      rollup: etatAgregat,
      warnings,
      truncated_groups: tronque,
    }),
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

/** Enveloppe `meta` commune aux deux chemins : une seule définition, pas deux. */
function metaCommune(
  request: ExplorerRequest,
  propre: Pick<ExplorerMeta, "source" | "approximate" | "rollup" | "warnings" | "truncated_groups">,
): ExplorerMeta {
  const { query, plan } = request;
  const definition = datasetDefinition(plan.dataset);
  return {
    app: query.scope.requestedApp ?? "all",
    period: query.range.preset ?? "custom",
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
    unit: definition.fields[plan.measure.field].unit,
    aggregation: plan.measure.aggregation,
    additive: estAdditive(plan.measure.aggregation),
    counting: definition.population,
    group_by: plan.groupBy,
    visualization: plan.visualization,
    coverage: couvertureRetention(query),
    query: canonicalAst(query, plan),
    ...propre,
  };
}

/**
 * Met en forme une lecture hybride : les distributions en seaux sont FUSIONNÉES
 * par groupe, puis le quantile est lu sur la distribution obtenue. Jamais une
 * moyenne de percentiles horaires — elle ne correspondrait à aucune mesure réelle.
 */
function rendreHybride(
  request: ExplorerRequest,
  source: RollupSource,
  lignes: HistogrammeRow[],
  etat: ExplorerMeta["rollup"],
): ExplorerResult {
  const { plan } = request;
  const p = plan.measure.aggregation === "p95" ? 0.95 : 0.75;
  const parGroupe = new Map<string | null, HistogrammeRow[]>();
  for (const ligne of lignes) {
    const cle = ligne.g0;
    const seaux = parGroupe.get(cle);
    if (seaux) seaux.push(ligne);
    else parGroupe.set(cle, [ligne]);
  }

  // L'agrégat n'a rien apporté (fenêtre trop récente, heures invalidées, base
  // jamais rafraîchie) : tout vient alors des lignes, et on le DIT. La valeur
  // reste APPROCHÉE pour autant — la branche brute range elle aussi ses mesures
  // en seaux, faute de quoi les deux ne se fusionneraient pas.
  const venuDeLAgregat = lignes.some((ligne) => ligne.origine === "agregat");

  const groupes: ExplorerGroup[] = [...parGroupe]
    .map(([valeur, seaux]) => ({
      key: plan.groupBy.length ? [valeur] : [],
      value: percentileFusionne(seaux, p),
      samples: effectif(seaux),
    }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || String(a.key[0]).localeCompare(String(b.key[0])));

  const warnings = avertissements(plan);
  if (source.notice) warnings.push(source.notice);

  return {
    meta: metaCommune(request, {
      // `rollup+raw` même quand la fenêtre est entièrement couverte : la branche
      // brute reste dans la requête, elle a simplement compté zéro ligne.
      source: venuDeLAgregat ? "rollup+raw" : "raw",
      approximate: source.approximate,
      rollup: etat,
      warnings,
      truncated_groups: plan.groupBy.length > 0 && groupes.length > plan.limit,
    }),
    data: {
      // Le total porte sur TOUTE la population, fusionnée d'un seul tenant —
      // indépendamment du classement, comme sur le chemin brut.
      total: percentileFusionne(lignes, p),
      samples: effectif(lignes),
      groups: plan.groupBy.length ? groupes.slice(0, plan.limit) : [],
      series: [],
      rows: [],
      next_cursor: null,
    },
  };
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
