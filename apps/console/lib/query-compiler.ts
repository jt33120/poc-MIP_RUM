// Compilateur des prédicats du contrat de filtres (P6.2) — logique PURE, testée.
//
// SÛRETÉ. Les identifiants SQL (tables, colonnes, alias) viennent EXCLUSIVEMENT du
// registre ci-dessous et des cibles écrites dans le code ; toute valeur venue de
// l'URL est un paramètre lié `$n`. Aucune concaténation de valeur utilisateur.
//
// CAPACITÉS. Une dimension n'est compilée que si le jeu de données la porte ET si
// sa colonne existe dans le schéma interrogé (les dimensions collectées de P6.1
// arrivent par migration : la console peut précéder le schéma). Sinon : erreur
// typée `unsupported_dimension`, jamais un filtre ignoré en silence.
import {
  DIMENSION_LABELS,
  conditionsOf,
  type AnalyticsQuery,
  type ContractError,
  type Dimension,
  type Parsed,
  type ResolvedRange,
} from "./query-contract";

export const DATASETS = [
  "sessions",
  "views",
  "vitals",
  "errors",
  "events",
  "custom_events",
  "actions",
  "longtasks",
  "resources",
  "spans",
  "synthetic",
] as const;
export type DatasetId = (typeof DATASETS)[number];

export interface DimensionColumn {
  /** Colonne de la ligne, ou de la session jointe (app-scopée). */
  on: "row" | "session";
  table: string;
  column: string;
}

interface DatasetDefinition {
  table: string;
  label: string;
  /** La ligne porte un `session_id` joignable à `rum_session` (même app). */
  sessioned: boolean;
  dimensions: Partial<Record<Dimension, DimensionColumn>>;
}

const sessionColumn = (column: string): DimensionColumn => ({ on: "session", table: "rum_session", column });
const rowColumn = (table: string, column: string): DimensionColumn => ({ on: "row", table, column });

// Dimensions de session. `browser` et `os` : colonnes nullables ajoutées par la
// collecte P6.1 ; tant qu'elles manquent, la dimension est « non collectée ».
const SESSION_DIMENSIONS: Partial<Record<Dimension, DimensionColumn>> = {
  device: sessionColumn("device_type"),
  country: sessionColumn("geo_country"),
  client: sessionColumn("client_id"),
  source: sessionColumn("collection_source"),
  browser: sessionColumn("browser"),
  os: sessionColumn("os"),
};

// Release, env et service sont des instantanés PAR OCCURRENCE : la release de la
// session est mutable et ne s'applique jamais au passé.
function occurrenceDimensions(table: string, route = "route"): Partial<Record<Dimension, DimensionColumn>> {
  return {
    route: rowColumn(table, route),
    release: rowColumn(table, "release"),
    env: rowColumn(table, "env"),
    service: rowColumn(table, "service"),
  };
}

export const DATASET_REGISTRY: Record<DatasetId, DatasetDefinition> = {
  sessions: { table: "rum_session", label: "les sessions", sessioned: true, dimensions: SESSION_DIMENSIONS },
  views: {
    table: "rum_pageview",
    label: "les pages vues",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, ...occurrenceDimensions("rum_pageview") },
  },
  vitals: {
    table: "rum_metric",
    label: "les Web Vitals",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, ...occurrenceDimensions("rum_metric") },
  },
  errors: {
    table: "rum_error",
    label: "les erreurs",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, ...occurrenceDimensions("rum_error") },
  },
  events: {
    table: "rum_event_index",
    label: "le journal d'événements",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, ...occurrenceDimensions("rum_event_index") },
  },
  custom_events: {
    table: "rum_event",
    label: "les événements custom",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, ...occurrenceDimensions("rum_event") },
  },
  actions: {
    table: "rum_action",
    label: "les actions",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, route: rowColumn("rum_action", "route") },
  },
  longtasks: {
    table: "rum_longtask",
    label: "les tâches longues",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, route: rowColumn("rum_longtask", "route") },
  },
  resources: {
    table: "rum_resource",
    label: "les ressources",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, route: rowColumn("rum_resource", "route") },
  },
  spans: {
    table: "rum_span",
    label: "les appels tracés",
    sessioned: true,
    dimensions: { ...SESSION_DIMENSIONS, ...occurrenceDimensions("rum_span") },
  },
  synthetic: {
    table: "syn_snapshot",
    label: "les mesures du robot synthétique",
    sessioned: false,
    dimensions: { route: rowColumn("syn_snapshot", "route_hint") },
  },
};

/** Colonnes présentes, sous la forme `table.colonne`. */
export type DimensionSchema = ReadonlySet<string>;

/** Toutes les colonnes que le registre peut interroger (sonde de schéma). */
export function registryColumns(): { tables: string[]; columns: string[] } {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const dataset of Object.values(DATASET_REGISTRY)) {
    for (const source of Object.values(dataset.dimensions)) {
      if (!source) continue;
      tables.add(source.table);
      columns.add(source.column);
    }
  }
  return { tables: [...tables].sort(), columns: [...columns].sort() };
}

export type DimensionSupport =
  | { supported: true; source: DimensionColumn }
  | { supported: false; reason: "not_applicable" | "not_collected"; message: string };

export function dimensionSupport(dataset: DatasetId, dimension: Dimension, schema: DimensionSchema): DimensionSupport {
  const definition = DATASET_REGISTRY[dataset];
  const source = definition.dimensions[dimension];
  if (!source) {
    return {
      supported: false,
      reason: "not_applicable",
      message: `« ${DIMENSION_LABELS[dimension]} » est sans objet pour ${definition.label}`,
    };
  }
  if (!schema.has(`${source.table}.${source.column}`)) {
    return {
      supported: false,
      reason: "not_collected",
      message: `« ${DIMENSION_LABELS[dimension]} » n'est pas encore collecté pour ${definition.label}`,
    };
  }
  return { supported: true, source };
}

export function unsupportedError(dimension: Dimension, message: string): ContractError {
  return { code: "unsupported_dimension", message, dimension };
}

export type Bind = (value: unknown) => string;

/** Liste de paramètres liés : chaque valeur est ajoutée une fois, rendue en `$n`. */
export function binder(params: unknown[] = []): { params: unknown[]; bind: Bind } {
  return { params, bind: (value) => `$${params.push(value)}` };
}

export interface CompileTarget {
  dataset: DatasetId;
  /** Alias de la ligne (constante de code). */
  row: string;
  /** Alias de la session app-scopée ; pour `sessions`, l'alias de la ligne. Absent : pas de session. */
  session?: string;
  /** Colonne temporelle qualifiée ; null = aucune fenêtre (liste de configuration). */
  time: string | null;
  /** Plage à appliquer à la place de celle de la requête (période précédente…). */
  range?: ResolvedRange;
  /** Colonne d'app qualifiée, si elle n'est pas `<row>.app_id`. */
  app?: string;
  /** `false` : le périmètre d'apps est compilé à part (`compileScope`) par l'appelant. */
  scope?: boolean;
}

const ALIAS = /^[a-z][a-z0-9_]{0,15}$/;
const QUALIFIED = /^[a-z][a-z0-9_]{0,15}\.[a-z][a-z0-9_]{0,62}$/;

function assertIdentifiers(target: CompileTarget): void {
  // Les alias sont des constantes de code : une valeur inattendue est un bug, pas
  // une entrée utilisateur à nettoyer.
  if (!ALIAS.test(target.row) || (target.session !== undefined && !ALIAS.test(target.session))) {
    throw new Error(`alias SQL invalide pour ${target.dataset}`);
  }
  if ((target.time !== null && !QUALIFIED.test(target.time)) || (target.app !== undefined && !QUALIFIED.test(target.app))) {
    throw new Error(`colonne SQL invalide pour ${target.dataset}`);
  }
}

/** Jointure de session TOUJOURS scopée par app (un session_id est émis par le client). */
export function sessionJoin(row: string, session: string): string {
  return `left join rum_session ${session} on ${session}.app_id = ${row}.app_id and ${session}.session_id = ${row}.session_id`;
}

/**
 * Prédicats d'une requête pour une cible : fenêtre [from,to), périmètre d'apps,
 * apps internes, conditions et exclusion des bots. Rend une suite de ` and …`
 * (vide si rien ne s'applique) ou une erreur `unsupported_dimension`.
 */
export function compileWhere(query: AnalyticsQuery, target: CompileTarget, schema: DimensionSchema, bind: Bind): Parsed<string> {
  assertIdentifiers(target);
  const definition = DATASET_REGISTRY[target.dataset];
  let sql = "";

  if (target.time !== null) {
    const range = target.range ?? query.range;
    sql += ` and ${target.time} >= ${bind(range.from)}::timestamptz and ${target.time} < ${bind(range.to)}::timestamptz`;
  }

  if (target.scope !== false) sql += compileScope(query, target.app ?? `${target.row}.app_id`, bind);

  for (const condition of conditionsOf(query.filters)) {
    const support = dimensionSupport(target.dataset, condition.dimension, schema);
    if (!support.supported) return { ok: false, error: unsupportedError(condition.dimension, support.message) };
    const alias = support.source.on === "row" ? target.row : target.session;
    if (!alias) {
      return {
        ok: false,
        error: unsupportedError(condition.dimension, `« ${DIMENSION_LABELS[condition.dimension]} » exige la session, absente ici`),
      };
    }
    const column = `${alias}.${support.source.column}`;
    sql +=
      condition.operator === "is_null"
        ? ` and ${column} is null`
        : ` and ${column} ${condition.operator === "eq" ? "=" : "<>"} ${bind(condition.value)}`;
  }

  if (definition.sessioned && target.session && !query.filters.includeBots) {
    sql += ` and not coalesce(${target.session}.is_bot, false)`;
  }

  return { ok: true, value: sql };
}

/**
 * Périmètre seul (apps effectives, apps internes) d'une table sans dimension
 * filtrable : listes de configuration, vues agrégées par app. Les filtres de
 * population ne s'y appliquent pas — la surface le déclare.
 */
export function compileScope(query: AnalyticsQuery, appColumn: string, bind: Bind): string {
  if (!QUALIFIED.test(appColumn)) throw new Error("colonne d'app invalide");
  const apps = query.scope.effectiveApps;
  if (apps !== null) return ` and ${appColumn} = any(${bind(apps)}::text[])`;
  return query.filters.includeInternal ? "" : ` and ${appColumn} not in (select app_id from app_registry where internal)`;
}

/** Variante qui lève l'erreur typée : pour les lectures dont la surface a déjà validé ses capacités. */
export function compileWhereOrThrow(query: AnalyticsQuery, target: CompileTarget, schema: DimensionSchema, bind: Bind): string {
  const compiled = compileWhere(query, target, schema, bind);
  if (!compiled.ok) throw new UnsupportedFilterError(compiled.error);
  return compiled.value;
}

export class UnsupportedFilterError extends Error {
  constructor(readonly error: ContractError) {
    super(error.message);
    this.name = "UnsupportedFilterError";
  }
}

// ─────────────────────────────── Seaux UTC ───────────────────────────────────
//
// Origine d'alignement EXPLICITEMENT UTC : `timestamptz '2000-01-01'` dépend du
// fuseau de la session PostgreSQL, et décalait les seaux d'une ou deux heures sur
// une connexion réglée sur Paris.

const UTC_ORIGIN = "timestamptz '2000-01-01 00:00:00+00'";

function bucketInterval(range: ResolvedRange): string {
  if (!Number.isSafeInteger(range.bucketSeconds) || range.bucketSeconds <= 0) {
    throw new Error("largeur de seau invalide");
  }
  return `interval '${range.bucketSeconds} seconds'`;
}

/** Seau aligné UTC d'une colonne temporelle qualifiée. */
export function bucketExpr(column: string, range: ResolvedRange): string {
  if (!QUALIFIED.test(column) && !/^[a-z][a-z0-9_]{0,62}$/.test(column)) throw new Error("colonne de seau invalide");
  return `date_bin(${bucketInterval(range)}, ${column}, ${UTC_ORIGIN})`;
}

/** Série des seaux couvrant [from,to), zéros compris (le dernier contient l'instant avant `to`). */
export function bucketSeriesSql(range: ResolvedRange, bind: Bind): string {
  const width = bucketInterval(range);
  return `generate_series(date_bin(${width}, ${bind(range.from)}::timestamptz, ${UTC_ORIGIN}),
                          ${bind(range.to)}::timestamptz - interval '1 microsecond', ${width})`;
}
