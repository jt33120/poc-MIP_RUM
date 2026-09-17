// Registre et validation de la requête analytique (P6.4) — logique PURE, testée,
// sans accès base.
//
// ALLOWLIST FERMÉE. Un jeu de données, une mesure, une dimension ou une
// représentation qui ne figurent pas ci-dessous n'existent pas pour l'Explorer.
// Les identifiants SQL (tables, colonnes) viennent EXCLUSIVEMENT de ce registre :
// aucune valeur reçue d'un client n'est jamais concaténée dans une instruction.
// La seule chaîne venue de l'appelant qui touche le SQL est le NOM d'une propriété
// JSON, et il y entre comme paramètre lié (`props -> $n`), jamais comme identifiant.
//
// VOCABULAIRE PARTAGÉ. Les jeux de données sont ceux du contrat P6.2
// (`lib/query-compiler.ts`) : même table, mêmes dimensions, même sonde de schéma.
// L'Explorer n'introduit pas un troisième modèle, il déclare en plus ce qu'on peut
// MESURER sur chacun — unité, population, opérateurs et avertissement de collecte.
//
// CE QUI N'EST PAS PROMIS. Pas de formule libre, pas de recherche sur une clé
// arbitraire, pas de scan sans limite : 2 dimensions de regroupement, 50
// combinaisons au total, 200 lignes de journal, 32 Kio de corps de requête.
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_NAME_MAX,
  DEVICES,
  FILTER_OPERATORS,
  MAX_CONDITIONS,
  RANGE_PRESETS,
  VALUE_MAX,
  fnv1a,
  isSafeText,
  resolveRange,
  resolveScope,
  requestedAppOf,
  type AnalyticsQuery,
  type ContractError,
  type Dimension,
  type FilterCondition,
  type FilterOperator,
  type Parsed,
  type ScopePrincipal,
  QUERY_VERSION,
} from "./query-contract";
import type { DatasetId } from "./query-compiler";

export const EXPLORER_VERSION = 1 as const;

/** Au plus 2 dimensions de regroupement, et 50 COMBINAISONS au total (pas 50 × 50). */
export const MAX_GROUP_BY = 2;
export const MAX_GROUPS = 50;
/** Journal paginé : 200 lignes au plus. Il ne sert jamais à calculer un graphe. */
export const MAX_ROWS = 200;
export const DEFAULT_ROWS = 50;
/** Corps de requête : 32 Kio, vérifiés avant tout parsing. */
export const MAX_BODY_BYTES = 32 * 1024;
/** Nom de propriété JSON mesurable : borné comme une clé d'attribut P4. */
const PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const MAX_CURSOR_LENGTH = 512;

export const AGGREGATIONS = ["count", "sum", "avg", "p75", "p95", "distinct"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const VISUALIZATIONS = ["value", "toplist", "timeseries", "table"] as const;
export type Visualization = (typeof VISUALIZATIONS)[number];

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  count: "Nombre",
  sum: "Somme",
  avg: "Moyenne",
  p75: "p75",
  p95: "p95",
  distinct: "Distincts",
};

export const VISUALIZATION_LABELS: Record<Visualization, string> = {
  value: "Valeur unique",
  toplist: "Classement",
  timeseries: "Série temporelle",
  table: "Journal",
};

/**
 * Une agrégation est ADDITIVE si la valeur d'un ensemble est la somme des valeurs
 * de ses parties. Un percentile et un dénombrement de distincts ne le sont pas :
 * ils n'admettent ni seau à zéro, ni ligne « Autres ».
 */
export function estAdditive(aggregation: Aggregation): boolean {
  return aggregation === "count" || aggregation === "sum";
}

// ─────────────────────────────── Le registre ─────────────────────────────────

/** Colonne d'identité à dénombrer, avec le filtre qui la rend dénombrable. */
export interface GuardedColumn {
  column: string;
  on?: "row" | "session";
  /** Condition supplémentaire : compter des visiteurs exige un identifiant aléatoire. */
  guard?: { column: string; value: string };
}

export interface FieldDefinition {
  label: string;
  /** Unité annoncée dans `meta.unit`. */
  unit: string;
  /**
   * `rows` : la ligne elle-même (dénombrement). `column` : colonne numérique du
   * registre. `json` : propriété numérique déclarée par l'appelant, castée
   * seulement après contrôle `jsonb_typeof = 'number'`. `identity` : colonne
   * d'identité, dénombrée en distincts.
   */
  kind: "rows" | "column" | "json" | "identity";
  column?: string;
  /** Colonne portée par la session jointe plutôt que par la ligne. */
  on?: "row" | "session";
  identity?: GuardedColumn;
  /** Colonne JSON dont une propriété numérique peut être mesurée. */
  json?: { column: string };
  aggregations: readonly Aggregation[];
  /** Mesure réservée à une valeur de l'axe `variant` du jeu de données. */
  variant?: string;
  /**
   * Fenêtre appliquée : `start` (défaut) borne la colonne temporelle du jeu ;
   * `overlap` retient les lignes dont la vie CHEVAUCHE la fenêtre.
   */
  window?: "start" | "overlap";
  /** `false` : la mesure n'a pas de seau honnête, donc pas de série temporelle. */
  bucketable?: boolean;
  /** Ce que la mesure ne dit pas — annoncé dans `meta.warnings`. */
  notice?: string;
}

/** Axe de sous-population FERMÉ : nom de Web Vital, API de tâche longue, palier de span. */
export interface VariantAxis {
  id: string;
  label: string;
  column: string;
  values: readonly string[];
  required: boolean;
  /** Valeur attribuée aux lignes dont la colonne est nulle (historique). */
  nullDefault?: string;
  /** Avertissement produit quand l'axe n'est pas choisi. */
  mixedNotice?: string;
}

export interface RowColumn {
  id: string;
  column: string;
  on?: "row" | "session";
  label: string;
}

export interface ExplorerDatasetDefinition {
  /** Jeu de données du contrat P6.2 : table, dimensions et sonde de schéma communes. */
  dataset: DatasetId;
  label: string;
  summary: string;
  /** Colonne temporelle de la ligne (non qualifiée). */
  time: string;
  /** Seconde borne temporelle, pour les mesures de chevauchement. */
  timeEnd?: string;
  /** Départage stable du journal paginé, à côté du temps. */
  key: { column: string; type: "bigint" | "text" };
  /** Population mesurée, telle qu'elle sera écrite dans `meta.counting`. */
  population: string;
  variant?: VariantAxis;
  fields: Record<string, FieldDefinition>;
  /**
   * Journal : projection FERMÉE, déjà scrubbée. Jamais un `select *`. L'`id`
   * d'une colonne est son nom PUBLIC — celui des lignes rendues et du registre
   * de capacités —, distinct de la colonne SQL, qui ne sort jamais d'ici.
   */
  rows: readonly RowColumn[];
  /** Limites de collecte du jeu, indépendantes de la requête. */
  notices: readonly string[];
}

const COUNT = ["count"] as const;
const DUREE = ["avg", "p75", "p95"] as const;

/** Sessions distinctes : disponible partout où la ligne porte un `session_id`. */
const SESSIONS_DISTINCTES: FieldDefinition = {
  label: "Sessions distinctes",
  unit: "sessions",
  kind: "identity",
  identity: { column: "session_id" },
  aggregations: ["distinct"],
  notice: "Une session n'est ni un visiteur ni une personne : ces populations ne s'additionnent pas.",
};

/**
 * Visiteurs distincts : `visitor_id` n'existe que sur la session, et seulement
 * lorsqu'il a été tiré au hasard. L'empreinte de classe d'appareil (`id_kind =
 * 'device_class'`) est partagée par un parc homogène : la compter donnerait un
 * nombre de « visiteurs » plus petit que la réalité, sans le dire.
 */
const VISITEURS_DISTINCTS: FieldDefinition = {
  label: "Visiteurs distincts (identifiant aléatoire)",
  unit: "visiteurs",
  kind: "identity",
  identity: { column: "visitor_id", on: "session", guard: { column: "id_kind", value: "random" } },
  aggregations: ["distinct"],
  notice:
    "Visiteurs observés par identifiant aléatoire seulement : les sessions sans cet identifiant " +
    "(historique, ou empreinte de classe d'appareil) ne sont pas comptées.",
};

const UTILISATEURS_IDENTIFIES: FieldDefinition = {
  label: "Utilisateurs identifiés distincts",
  unit: "utilisateurs",
  kind: "identity",
  identity: { column: "user_id_hash" },
  aggregations: ["distinct"],
  notice: "Seules les occurrences portant une identité déclarée sont comptées.",
};

export const EXPLORER_DATASETS = {
  custom_events: {
    dataset: "custom_events",
    label: "Événements custom",
    summary: "Les événements déclarés par l'application, avec leurs propriétés bornées.",
    time: "ts",
    key: { column: "id", type: "bigint" },
    population: "événements reçus",
    variant: {
      id: "type",
      label: "Type d'événement",
      column: "event_type",
      values: ["custom", "timing"],
      required: false,
      // Les lignes écrites avant le typage explicite (v66) sont des événements custom.
      nullDefault: "custom",
    },
    fields: {
      rows: { label: "Événements", unit: "événements", kind: "rows", aggregations: COUNT },
      sessions: SESSIONS_DISTINCTES,
      identified_users: UTILISATEURS_IDENTIFIES,
      timing_ms: {
        label: "Durée déclarée",
        unit: "ms",
        kind: "column",
        column: "timing_ms",
        aggregations: ["sum", ...DUREE],
        // `timing_ms` n'a de sens que sur un événement de type `timing` : ailleurs
        // il est nul, et une moyenne sur un échantillon vide n'est pas un zéro.
        variant: "timing",
      },
      prop: {
        label: "Propriété numérique",
        unit: "valeur déclarée",
        kind: "json",
        json: { column: "props" },
        aggregations: ["sum", ...DUREE],
        notice:
          "Seules les propriétés réellement numériques sont mesurées : une valeur textuelle « 42 » " +
          "n'est pas le nombre 42, et les événements dont la propriété manque ou n'est pas un nombre sont écartés.",
      },
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "name", column: "name", label: "Événement" },
      { id: "type", column: "event_type", label: "Type" },
      { id: "route", column: "route", label: "Route" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [],
  },

  errors: {
    dataset: "errors",
    label: "Erreurs",
    summary: "Les erreurs reçues, comptées en occurrences et non en lignes.",
    time: "ts",
    key: { column: "id", type: "bigint" },
    population: "occurrences reçues",
    fields: {
      // Une ligne d'erreur porte le nombre de répétitions qu'elle a tues :
      // compter les lignes sous-estimerait l'impact réel.
      occurrences: {
        label: "Occurrences",
        unit: "occurrences",
        kind: "column",
        column: "occurrences",
        aggregations: ["sum"],
      },
      sessions: SESSIONS_DISTINCTES,
      visitors: VISITEURS_DISTINCTS,
      identified_users: UTILISATEURS_IDENTIFIES,
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "type", column: "error_type", label: "Type" },
      { id: "origin", column: "error_source", label: "Source" },
      { id: "occurrences", column: "occurrences", label: "Occurrences" },
      { id: "route", column: "route", label: "Route" },
      { id: "fingerprint", column: "fingerprint", label: "Signature" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [
      "L'échantillonnage des erreurs est biaisé : une session en erreur est conservée plus souvent " +
        "qu'une autre. Les comptes sont observés, jamais extrapolés.",
    ],
  },

  views: {
    dataset: "views",
    label: "Pages vues",
    summary: "Les vues de page, comptées à leur début.",
    time: "started_at",
    key: { column: "id", type: "bigint" },
    population: "vues commencées dans la fenêtre",
    fields: {
      rows: { label: "Pages vues", unit: "vues", kind: "rows", aggregations: COUNT },
      sessions: SESSIONS_DISTINCTES,
    },
    rows: [
      { id: "date", column: "started_at", label: "Date" },
      { id: "route", column: "route", label: "Route" },
      { id: "navigation", column: "nav_type", label: "Navigation" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: ["Aucun temps passé n'est dérivé de ces vues : le signal ne permet pas de le mesurer."],
  },

  sessions: {
    dataset: "sessions",
    label: "Sessions",
    summary: "Les sessions, selon qu'elles COMMENCENT dans la fenêtre ou qu'elles la chevauchent.",
    time: "started_at",
    timeEnd: "last_seen_at",
    key: { column: "session_id", type: "text" },
    population: "sessions observées",
    fields: {
      // Deux mesures DIFFÉRENTES, nommées différemment : « commencées » et
      // « actives » ne répondent pas à la même question et ne sont pas comparables.
      started: {
        label: "Sessions commencées dans la fenêtre",
        unit: "sessions",
        kind: "rows",
        aggregations: COUNT,
      },
      active: {
        label: "Sessions actives chevauchant la fenêtre",
        unit: "sessions",
        kind: "rows",
        aggregations: COUNT,
        window: "overlap",
        // Une session commencée avant la fenêtre n'a pas de seau dedans : lui en
        // inventer un ferait diverger la série du total.
        bucketable: false,
        notice:
          "Une session active peut avoir commencé avant la fenêtre : ce compte n'a pas de découpage " +
          "temporel honnête et n'est pas comparable aux sessions commencées.",
      },
      visitors: VISITEURS_DISTINCTS,
    },
    rows: [
      { id: "start", column: "started_at", label: "Début" },
      { id: "last_seen", column: "last_seen_at", label: "Dernier signe" },
      { id: "device", column: "device_type", label: "Appareil" },
      { id: "country", column: "geo_country", label: "Pays estimé" },
      { id: "views", column: "page_count", label: "Vues" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [],
  },

  vitals: {
    dataset: "vitals",
    label: "Web Vitals",
    summary: "Une métrique Web Vital nommée, mesurée sur sa valeur canonique.",
    time: "ts",
    key: { column: "id", type: "bigint" },
    population: "mesures reçues",
    variant: {
      id: "metric",
      label: "Métrique",
      column: "name",
      values: ["LCP", "INP", "CLS", "FCP", "TTFB"],
      // La table accueille aussi les métriques du serveur vocal (v51) : sans nom
      // explicite, une moyenne mélangerait deux produits.
      required: true,
    },
    fields: {
      rows: { label: "Mesures", unit: "mesures", kind: "rows", aggregations: COUNT },
      value: { label: "Valeur", unit: "unité de la métrique", kind: "column", column: "value", aggregations: DUREE },
      sessions: SESSIONS_DISTINCTES,
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "metric", column: "name", label: "Métrique" },
      { id: "value", column: "value", label: "Valeur" },
      { id: "rating", column: "rating", label: "Appréciation" },
      { id: "route", column: "route", label: "Route" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [
      "CLS et INP sont rapportés une fois par chargement de page : la valeur mesurée est celle " +
        "retenue par le SDK, pas la somme des rapports intermédiaires.",
    ],
  },

  resources: {
    dataset: "resources",
    label: "Ressources",
    summary: "Les ressources chargées, avec leur durée et leur poids observés.",
    time: "ts",
    key: { column: "id", type: "bigint" },
    population: "ressources collectées",
    fields: {
      rows: { label: "Ressources", unit: "ressources", kind: "rows", aggregations: COUNT },
      duration_ms: { label: "Durée", unit: "ms", kind: "column", column: "duration_ms", aggregations: DUREE },
      transfer_size: {
        label: "Poids transféré",
        unit: "octets",
        kind: "column",
        column: "transfer_size",
        aggregations: ["sum", ...DUREE],
      },
      sessions: SESSIONS_DISTINCTES,
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "type", column: "type", label: "Type" },
      { id: "duration_ms", column: "duration_ms", label: "Durée (ms)" },
      { id: "transfer_size", column: "transfer_size", label: "Octets" },
      { id: "route", column: "route", label: "Route" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [
      "Les ressources sont collectées selon le seuil du SDK : cette population est partielle par " +
        "construction, et son total ne vaut pas le trafic réseau réel.",
    ],
  },

  longtasks: {
    dataset: "longtasks",
    label: "Tâches longues",
    summary: "Les blocages du fil principal, mesurés par l'API Long Task ou par LoAF.",
    time: "ts",
    key: { column: "id", type: "bigint" },
    population: "blocages observés",
    variant: {
      id: "api",
      label: "API de mesure",
      column: "source",
      values: ["longtask", "loaf"],
      required: false,
      mixedNotice:
        "La population mélange l'API Long Task et LoAF, qui décrivent le même blocage de deux façons : " +
        "choisir une API avant d'additionner des durées.",
    },
    fields: {
      rows: { label: "Tâches longues", unit: "tâches", kind: "rows", aggregations: COUNT },
      duration_ms: {
        label: "Durée",
        unit: "ms",
        kind: "column",
        column: "duration_ms",
        aggregations: ["sum", ...DUREE],
        notice:
          "La somme des durées n'est pas du temps utilisateur unique : deux blocages successifs " +
          "peuvent appartenir à la même seconde vécue.",
      },
      blocking_ms: {
        label: "Part bloquante",
        unit: "ms",
        kind: "column",
        column: "blocking_ms",
        aggregations: ["sum", ...DUREE],
      },
      sessions: SESSIONS_DISTINCTES,
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "api", column: "source", label: "API" },
      { id: "duration_ms", column: "duration_ms", label: "Durée (ms)" },
      { id: "blocking_ms", column: "blocking_ms", label: "Bloquant (ms)" },
      { id: "route", column: "route", label: "Route" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [],
  },

  actions: {
    dataset: "actions",
    label: "Actions",
    summary: "Les actions utilisateur nommées, sans reconstruction de causalité.",
    time: "ts",
    key: { column: "action_id", type: "text" },
    population: "actions observées",
    variant: {
      id: "type",
      label: "Type d'action",
      column: "type",
      values: ["click", "manual"],
      required: false,
    },
    fields: {
      rows: { label: "Actions", unit: "actions", kind: "rows", aggregations: COUNT },
      sessions: SESSIONS_DISTINCTES,
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "name", column: "name", label: "Action" },
      { id: "type", column: "type", label: "Type" },
      { id: "route", column: "route", label: "Route" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: [
      "Une action porte ce que le SDK a observé : ni la durée de ce qu'elle a déclenché, ni un lien " +
        "de cause à effet reconstruit après coup.",
    ],
  },

  spans: {
    dataset: "spans",
    label: "Appels tracés",
    summary: "Les segments de trace, par palier et par service.",
    time: "ts",
    key: { column: "id", type: "bigint" },
    population: "segments reçus",
    variant: {
      id: "tier",
      label: "Palier",
      column: "tier",
      values: ["front", "back", "detail"],
      required: false,
    },
    fields: {
      rows: { label: "Segments", unit: "segments", kind: "rows", aggregations: COUNT },
      duration_ms: { label: "Durée", unit: "ms", kind: "column", column: "duration_ms", aggregations: DUREE },
      sessions: SESSIONS_DISTINCTES,
    },
    rows: [
      { id: "date", column: "ts", label: "Date" },
      { id: "name", column: "name", label: "Segment" },
      { id: "tier", column: "tier", label: "Palier" },
      { id: "nature", column: "kind", label: "Nature" },
      { id: "duration_ms", column: "duration_ms", label: "Durée (ms)" },
      { id: "status", column: "status_code", label: "Statut" },
      { id: "route", column: "route", label: "Route" },
      { id: "session", column: "session_id", label: "Session" },
    ],
    notices: ["Un segment de trace n'est pas une visite : ces deux populations ne se comparent pas."],
  },
} as const satisfies Record<string, ExplorerDatasetDefinition>;

export type ExplorerDatasetId = keyof typeof EXPLORER_DATASETS;
export const EXPLORER_DATASET_IDS = Object.keys(EXPLORER_DATASETS) as ExplorerDatasetId[];

export function isExplorerDataset(value: string): value is ExplorerDatasetId {
  return Object.hasOwn(EXPLORER_DATASETS, value);
}

/** Définition interne d'un jeu (colonnes comprises) : jamais sérialisée vers un client. */
export function datasetDefinition(dataset: ExplorerDatasetId): ExplorerDatasetDefinition {
  return EXPLORER_DATASETS[dataset] as ExplorerDatasetDefinition;
}

export function fieldDefinition(dataset: ExplorerDatasetId, field: string): FieldDefinition | null {
  const fields = datasetDefinition(dataset).fields;
  return Object.hasOwn(fields, field) ? fields[field] : null;
}

// ──────────────────────────────── L'AST validé ───────────────────────────────

export interface ExplorerMeasure {
  aggregation: Aggregation;
  field: string;
  /** Nom de la propriété JSON mesurée (champ de type `json` seulement). */
  property?: string;
}

export interface ExplorerCursor {
  /** Empreinte de la requête et du `to` résolu : un curseur ne traverse pas un changement. */
  fingerprint: string;
  ts: string;
  key: string;
}

export interface ExplorerPlan {
  version: typeof EXPLORER_VERSION;
  dataset: ExplorerDatasetId;
  measure: ExplorerMeasure;
  /** Valeur de l'axe de sous-population, ou null s'il n'est pas choisi. */
  variant: string | null;
  groupBy: Dimension[];
  visualization: Visualization;
  limit: number;
  cursor: ExplorerCursor | null;
}

export type ExplorerErrorCode =
  | ContractError["code"]
  | "invalid_query"
  | "unsupported_dataset"
  | "unsupported_measure"
  | "unsupported_visualization"
  | "invalid_cursor"
  | "stale_cursor"
  | "body_too_large"
  | "query_budget_exceeded";

export interface ExplorerError {
  code: ExplorerErrorCode;
  message: string;
  parameter?: string;
  dimension?: string;
}

export type ExplorerParsed<T> = { ok: true; value: T } | { ok: false; error: ExplorerError };

const ok = <T>(value: T): ExplorerParsed<T> => ({ ok: true, value });
const fail = (code: ExplorerErrorCode, message: string, extra: Partial<ExplorerError> = {}): ExplorerParsed<never> => ({
  ok: false,
  error: { code, message, ...extra },
});

/** 403 pour le périmètre, 503 pour un budget dépassé, 400 pour tout le reste. */
export function explorerErrorStatus(error: ExplorerError): 400 | 403 | 503 {
  if (error.code === "no_app_access" || error.code === "forbidden_app") return 403;
  return error.code === "query_budget_exceeded" ? 503 : 400;
}

/**
 * Budget de lecture dépassé (délai SQL). Levée par la couche I/O et rendue en 503 :
 * l'Explorer dit qu'il n'a pas pu répondre, il ne rend JAMAIS une série de zéros
 * qu'on prendrait pour une absence de trafic.
 */
export class ExplorerBudgetError extends Error {
  readonly code = "query_budget_exceeded" as const;
  constructor(message = "budget de lecture dépassé : réduire la période, les groupes ou les filtres") {
    super(message);
    this.name = "ExplorerBudgetError";
  }
}

/**
 * Dimension qu'un jeu de données ne porte pas, découverte à la compilation du SQL :
 * 400 typé, jamais un filtre ou un regroupement silencieusement ignoré.
 */
export class UnsupportedExplorerDimension extends Error {
  readonly code = "unsupported_dimension" as const;
  constructor(
    message: string,
    readonly dimension?: string,
  ) {
    super(message);
    this.name = "UnsupportedExplorerDimension";
  }
}

// ──────────────────────────────── Validation ─────────────────────────────────

function estObjet(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Aucune clé inconnue : une faute de frappe ne doit pas passer pour un défaut. */
function clesInconnues(source: Record<string, unknown>, connues: readonly string[]): string[] {
  return Object.keys(source).filter((key) => !connues.includes(key));
}

const CLES_RACINE = [
  "version",
  "app",
  "range",
  "dataset",
  "measure",
  "variant",
  "filters",
  "groupBy",
  "visualization",
  "limit",
  "cursor",
  "includeBots",
  "includeInternal",
] as const;

function parseFilters(raw: unknown): ExplorerParsed<FilterCondition[]> {
  if (raw === undefined || raw === null) return ok([]);
  if (!Array.isArray(raw)) return fail("invalid_query", "filters doit être un tableau", { parameter: "filters" });
  if (raw.length > MAX_CONDITIONS) {
    return fail("too_many_conditions", `au plus ${MAX_CONDITIONS} conditions combinées`, { parameter: "filters" });
  }
  const conditions: FilterCondition[] = [];
  for (const entry of raw) {
    if (!estObjet(entry)) return fail("invalid_query", "chaque filtre est un objet", { parameter: "filters" });
    const inconnues = clesInconnues(entry, ["field", "operator", "type", "value"]);
    if (inconnues.length) {
      return fail("invalid_query", `clé de filtre inconnue : ${inconnues[0].slice(0, 40)}`, { parameter: "filters" });
    }
    const field = entry.field;
    if (typeof field !== "string" || field.length > DIMENSION_NAME_MAX) {
      return fail("invalid_query", `nom de dimension invalide (${DIMENSION_NAME_MAX} caractères au plus)`, {
        parameter: "filters",
      });
    }
    if (!(DIMENSIONS as readonly string[]).includes(field)) {
      return fail("unsupported_dimension", `dimension inconnue : ${field}`, { parameter: "filters", dimension: field });
    }
    const operator = entry.operator;
    if (typeof operator !== "string" || !(FILTER_OPERATORS as readonly string[]).includes(operator)) {
      return fail("invalid_filter", `opérateur invalide pour ${field} (eq, neq ou is_null)`, {
        parameter: "filters",
        dimension: field,
      });
    }
    // Les dimensions du contrat sont toutes textuelles ; `type` reste accepté pour
    // que l'AST publié soit relisible tel quel, mais il ne peut pas mentir.
    if (entry.type !== undefined && entry.type !== "string") {
      return fail("invalid_filter", `type invalide pour ${field} : seules les dimensions textuelles existent`, {
        parameter: "filters",
        dimension: field,
      });
    }
    if (operator === "is_null") {
      if (entry.value !== undefined && entry.value !== null) {
        return fail("invalid_filter", `is_null ne prend pas de valeur (${field})`, {
          parameter: "filters",
          dimension: field,
        });
      }
      conditions.push({ dimension: field as Dimension, operator: "is_null", value: null });
      continue;
    }
    const value = entry.value;
    if (typeof value !== "string" || !isSafeText(value, VALUE_MAX)) {
      return fail("invalid_filter", `valeur invalide pour ${field} (1 à ${VALUE_MAX} caractères)`, {
        parameter: "filters",
        dimension: field,
      });
    }
    if (field === "device" && !(DEVICES as readonly string[]).includes(value)) {
      return fail("invalid_filter", "appareil invalide (desktop, mobile ou tablet)", {
        parameter: "filters",
        dimension: field,
      });
    }
    conditions.push({ dimension: field as Dimension, operator: operator as FilterOperator, value });
  }
  return ok(conditions);
}

function parseGroupBy(raw: unknown): ExplorerParsed<Dimension[]> {
  if (raw === undefined || raw === null) return ok([]);
  if (!Array.isArray(raw)) return fail("invalid_query", "groupBy doit être un tableau", { parameter: "groupBy" });
  if (raw.length > MAX_GROUP_BY) {
    return fail("invalid_query", `au plus ${MAX_GROUP_BY} dimensions de regroupement`, { parameter: "groupBy" });
  }
  const groupBy: Dimension[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length > DIMENSION_NAME_MAX) {
      return fail("invalid_query", `dimension de regroupement invalide (${DIMENSION_NAME_MAX} caractères au plus)`, {
        parameter: "groupBy",
      });
    }
    if (!(DIMENSIONS as readonly string[]).includes(entry)) {
      return fail("unsupported_dimension", `dimension inconnue : ${entry}`, { parameter: "groupBy", dimension: entry });
    }
    if (groupBy.includes(entry as Dimension)) {
      return fail("invalid_query", `dimension de regroupement répétée : ${entry}`, { parameter: "groupBy" });
    }
    groupBy.push(entry as Dimension);
  }
  return ok(groupBy);
}

function parseMeasure(dataset: ExplorerDatasetId, raw: unknown): ExplorerParsed<{ measure: ExplorerMeasure; definition: FieldDefinition }> {
  if (!estObjet(raw)) return fail("invalid_query", "measure est un objet { aggregation, field }", { parameter: "measure" });
  const inconnues = clesInconnues(raw, ["aggregation", "field", "property"]);
  if (inconnues.length) {
    return fail("invalid_query", `clé de mesure inconnue : ${inconnues[0].slice(0, 40)}`, { parameter: "measure" });
  }
  const { aggregation, field } = raw;
  if (typeof field !== "string" || field.length > DIMENSION_NAME_MAX) {
    return fail("invalid_query", "field de mesure invalide", { parameter: "measure" });
  }
  const definition = fieldDefinition(dataset, field);
  // Un champ absent du catalogue n'existe pas : ni message, ni pile, ni URL brute,
  // ni identité ne sont mesurables, et le refus ne dit pas s'ils existent ailleurs.
  if (!definition) {
    return fail("unsupported_measure", `mesure inconnue pour ${datasetDefinition(dataset).label} : ${field}`, {
      parameter: "measure",
    });
  }
  if (typeof aggregation !== "string" || !(AGGREGATIONS as readonly string[]).includes(aggregation)) {
    return fail("invalid_query", "agrégation invalide (count, sum, avg, p75, p95 ou distinct)", { parameter: "measure" });
  }
  if (!definition.aggregations.includes(aggregation as Aggregation)) {
    return fail(
      "unsupported_measure",
      `« ${AGGREGATION_LABELS[aggregation as Aggregation]} » ne s'applique pas à « ${definition.label} »`,
      { parameter: "measure" },
    );
  }
  const measure: ExplorerMeasure = { aggregation: aggregation as Aggregation, field };
  if (definition.kind === "json") {
    const property = raw.property;
    if (typeof property !== "string" || !PROPERTY_KEY.test(property)) {
      return fail("invalid_query", "property est une clé de propriété bornée (lettre puis lettres, chiffres, . _ -)", {
        parameter: "measure",
      });
    }
    measure.property = property;
  } else if (raw.property !== undefined) {
    return fail("invalid_query", `« ${definition.label} » ne se mesure pas sur une propriété`, { parameter: "measure" });
  }
  return ok({ measure, definition });
}

function parseVariant(
  dataset: ExplorerDatasetId,
  raw: unknown,
  field: FieldDefinition,
): ExplorerParsed<string | null> {
  const axis = datasetDefinition(dataset).variant;
  if (!axis) {
    if (raw !== undefined && raw !== null) {
      return fail("invalid_query", `${datasetDefinition(dataset).label} n'a pas de sous-population à choisir`, {
        parameter: "variant",
      });
    }
    if (field.variant) throw new Error(`mesure ${field.label} liée à un axe absent`);
    return ok(null);
  }
  const demande = raw === undefined || raw === null ? null : raw;
  if (demande !== null && (typeof demande !== "string" || !axis.values.includes(demande))) {
    return fail("invalid_query", `${axis.label} : valeurs acceptées ${axis.values.join(", ")}`, { parameter: "variant" });
  }
  // Une mesure réservée impose sa sous-population : la demander autrement est une
  // contradiction, pas une préférence qu'on arbitre en silence.
  if (field.variant) {
    if (demande !== null && demande !== field.variant) {
      return fail("invalid_query", `« ${field.label} » exige ${axis.label.toLowerCase()} = ${field.variant}`, {
        parameter: "variant",
      });
    }
    return ok(field.variant);
  }
  if (demande === null && axis.required) {
    return fail("invalid_query", `${axis.label} est obligatoire (${axis.values.join(", ")})`, { parameter: "variant" });
  }
  return ok(demande as string | null);
}

function parseLimit(raw: unknown, visualization: Visualization): ExplorerParsed<number> {
  const max = visualization === "table" ? MAX_ROWS : MAX_GROUPS;
  if (raw === undefined || raw === null) return ok(visualization === "table" ? DEFAULT_ROWS : 10);
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > max) {
    return fail("invalid_query", `limit est un entier de 1 à ${max}`, { parameter: "limit" });
  }
  return ok(raw);
}

export function encodeExplorerCursor(cursor: ExplorerCursor): string {
  return Buffer.from(JSON.stringify([cursor.fingerprint, cursor.ts, cursor.key]), "utf8").toString("base64url");
}

/** `undefined` : curseur illisible ou falsifié. `null` : aucun curseur. */
function decodeExplorerCursor(raw: unknown): ExplorerCursor | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 3) return undefined;
    const [fingerprint, ts, key] = decoded;
    if (typeof fingerprint !== "string" || !/^[0-9a-f]{8}$/.test(fingerprint)) return undefined;
    // Pas de passage par `Date` : PostgreSQL conserve les microsecondes que
    // JavaScript tronque, et deux lignes du même instant perdraient une page.
    if (typeof ts !== "string" || ts.length > 40 || !Number.isFinite(Date.parse(ts))) return undefined;
    if (typeof key !== "string" || key.length === 0 || key.length > 200) return undefined;
    return { fingerprint, ts, key };
  } catch {
    return undefined;
  }
}

/**
 * Empreinte d'une requête PAGINABLE : ce qui, changé, invalide un curseur — la
 * version, le périmètre effectif, les DEUX bornes résolues, le jeu de données, la
 * sous-population, les filtres triés et le tri implicite du journal. Le curseur ne
 * survit donc ni à un changement de plage, ni à un filtre ajouté, ni à une autre app.
 */
export function explorerFingerprint(query: AnalyticsQuery, plan: ExplorerPlan): string {
  return fnv1a(
    JSON.stringify([
      plan.version,
      query.scope.effectiveApps ?? "*",
      query.range.from,
      query.range.to,
      plan.dataset,
      plan.variant,
      query.filters.includeBots,
      query.filters.includeInternal,
      [...query.filters.segments]
        .map((c) => [c.dimension, c.operator, c.value])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]),
  );
}

export interface ExplorerParseOptions {
  principal: ScopePrincipal | null;
  nowMs: number;
}

export interface ExplorerRequest {
  query: AnalyticsQuery;
  plan: ExplorerPlan;
}

/**
 * Valide un AST reçu d'un client et rend la requête résolue (périmètre signé,
 * plage unique) plus le plan d'exécution. AUCUN accès base : ce module ne sait
 * pas quelles colonnes existent, seulement lesquelles sont déclarées.
 */
/** Champs du PLAN, encore non typés : l'écran les tire d'une URL, l'API d'un corps JSON. */
export interface ExplorerPlanSource {
  dataset?: unknown;
  measure?: unknown;
  variant?: unknown;
  visualization?: unknown;
  groupBy?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

/**
 * Valide la partie « quoi mesurer », contre une requête de filtres DÉJÀ résolue
 * (périmètre signé, plage unique). L'écran `/explorer` la réutilise telle quelle :
 * il a résolu ses filtres par le contrat commun, et une seconde résolution
 * donnerait une autre fenêtre — l'horloge ayant avancé entre les deux.
 */
export function parseExplorerPlan(source: ExplorerPlanSource, query: AnalyticsQuery): ExplorerParsed<ExplorerPlan> {
  const dataset = source.dataset;
  if (typeof dataset !== "string" || !isExplorerDataset(dataset)) {
    return fail("unsupported_dataset", `jeu de données inconnu : ${String(dataset).slice(0, 40)}`, {
      parameter: "dataset",
    });
  }

  const measure = parseMeasure(dataset, source.measure);
  if (!measure.ok) return measure;
  const variant = parseVariant(dataset, source.variant, measure.value.definition);
  if (!variant.ok) return variant;

  const visualization = source.visualization ?? "value";
  if (typeof visualization !== "string" || !(VISUALIZATIONS as readonly string[]).includes(visualization)) {
    return fail("unsupported_visualization", `représentation inconnue (${VISUALIZATIONS.join(", ")})`, {
      parameter: "visualization",
    });
  }
  if (visualization === "timeseries" && measure.value.definition.bucketable === false) {
    return fail(
      "unsupported_visualization",
      `« ${measure.value.definition.label} » n'a pas de découpage temporel honnête : série temporelle refusée`,
      { parameter: "visualization" },
    );
  }

  const groupBy = parseGroupBy(source.groupBy);
  if (!groupBy.ok) return groupBy;
  const limit = parseLimit(source.limit, visualization as Visualization);
  if (!limit.ok) return limit;

  const plan: ExplorerPlan = {
    version: EXPLORER_VERSION,
    dataset,
    measure: measure.value.measure,
    variant: variant.value,
    groupBy: groupBy.value,
    visualization: visualization as Visualization,
    limit: limit.value,
    cursor: null,
  };

  const cursor = decodeExplorerCursor(source.cursor);
  if (cursor === undefined) return fail("invalid_cursor", "curseur illisible", { parameter: "cursor" });
  if (cursor) {
    if (plan.visualization !== "table") {
      return fail("invalid_cursor", "un curseur ne pagine que le journal", { parameter: "cursor" });
    }
    // Le curseur porte l'empreinte de la requête qui l'a produit : changer un
    // filtre, la fenêtre ou l'app le rend caduc, et il le DIT au lieu de rendre
    // une page prélevée dans une autre population.
    if (cursor.fingerprint !== explorerFingerprint(query, plan)) {
      return fail("stale_cursor", "la requête a changé depuis ce curseur : relancer sans curseur", {
        parameter: "cursor",
      });
    }
    plan.cursor = cursor;
  }
  return ok(plan);
}

/** AST complet reçu d'un client : filtres et plan, validés puis résolus ensemble. */
export function parseExplorerQuery(body: unknown, options: ExplorerParseOptions): ExplorerParsed<ExplorerRequest> {
  if (!estObjet(body)) return fail("invalid_query", "le corps est un objet JSON");
  const inconnues = clesInconnues(body, CLES_RACINE);
  if (inconnues.length) return fail("invalid_query", `clé inconnue : ${inconnues[0].slice(0, 40)}`);
  if (body.version !== undefined && body.version !== EXPLORER_VERSION) {
    return fail("invalid_query", `version de requête non supportée (attendue : ${EXPLORER_VERSION})`, {
      parameter: "version",
    });
  }

  const filters = parseFilters(body.filters);
  if (!filters.ok) return filters;
  for (const flag of ["includeBots", "includeInternal"] as const) {
    if (body[flag] !== undefined && typeof body[flag] !== "boolean") {
      return fail("invalid_query", `${flag} est un booléen`, { parameter: flag });
    }
  }
  const range = parseRange(body.range, options.nowMs);
  if (!range.ok) return range;

  const app = body.app;
  if (app !== undefined && app !== null && typeof app !== "string") {
    return fail("invalid_query", "app est une chaîne", { parameter: "app" });
  }
  // Le périmètre vient du principal SIGNÉ : `app` est une demande, jamais un droit.
  const scope = resolveScope(options.principal, requestedAppOf(app as string | null | undefined));
  if (!scope.ok) return { ok: false, error: scope.error };

  const query: AnalyticsQuery = {
    version: QUERY_VERSION,
    scope: scope.value,
    range: range.value,
    filters: {
      includeBots: body.includeBots === true,
      includeInternal: body.includeInternal === true,
      segments: filters.value,
    },
  };
  const plan = parseExplorerPlan(body, query);
  return plan.ok ? ok({ query, plan: plan.value }) : plan;
}

/** `range` accepte EXACTEMENT `{preset}` ou `{from,to}` — jamais les deux, jamais rien. */
function parseRange(raw: unknown, nowMs: number): ExplorerParsed<AnalyticsQuery["range"]> {
  if (!estObjet(raw)) return fail("invalid_range", "range est un objet { preset } ou { from, to }", { parameter: "range" });
  const inconnues = clesInconnues(raw, ["preset", "from", "to"]);
  if (inconnues.length) {
    return fail("invalid_range", `clé de plage inconnue : ${inconnues[0].slice(0, 40)}`, { parameter: "range" });
  }
  const aPreset = raw.preset !== undefined;
  const aBornes = raw.from !== undefined || raw.to !== undefined;
  if (aPreset && aBornes) {
    return fail("range_conflict", "préciser soit preset, soit from et to, pas les deux", { parameter: "range" });
  }
  if (!aPreset && !aBornes) {
    return fail("invalid_range", `range exige un preset (${RANGE_PRESETS.join(", ")}) ou un couple from/to`, {
      parameter: "range",
    });
  }
  if (aPreset) {
    // Contrairement aux anciennes URL, un preset inconnu n'est pas rabattu sur 24 h :
    // le nouveau contrat refuse plutôt que de mesurer une autre fenêtre en silence.
    if (typeof raw.preset !== "string" || !(RANGE_PRESETS as readonly string[]).includes(raw.preset)) {
      return fail("invalid_range", `preset inconnu (${RANGE_PRESETS.join(", ")})`, { parameter: "range" });
    }
    const resolved = resolveRange({ period: raw.preset }, nowMs);
    return resolved.ok ? ok(resolved.value) : { ok: false, error: resolved.error };
  }
  if (typeof raw.from !== "string" || typeof raw.to !== "string") {
    return fail("invalid_range", "from et to sont des instants ISO UTC (…Z)", { parameter: "range" });
  }
  const resolved = resolveRange({ from: raw.from, to: raw.to }, nowMs);
  return resolved.ok ? ok(resolved.value) : { ok: false, error: resolved.error };
}

/**
 * AST CANONIQUE : l'objet exact à enregistrer dans un tableau de bord (P6.5).
 * Il rejoue la requête telle qu'elle a été exécutée — plage résolue comprise pour
 * une fenêtre personnalisée, preset conservé pour une fenêtre glissante, qui doit
 * rester glissante. Aucune donnée de résultat n'y figure.
 */
export function canonicalAst(query: AnalyticsQuery, plan: ExplorerPlan): Record<string, unknown> {
  const range = query.range.preset
    ? { preset: query.range.preset }
    : { from: query.range.from, to: query.range.to };
  const ast: Record<string, unknown> = {
    version: plan.version,
    app: query.scope.requestedApp,
    range,
    dataset: plan.dataset,
    measure: plan.measure.property
      ? { aggregation: plan.measure.aggregation, field: plan.measure.field, property: plan.measure.property }
      : { aggregation: plan.measure.aggregation, field: plan.measure.field },
    filters: query.filters.segments.map((c) =>
      c.operator === "is_null"
        ? { field: c.dimension, operator: c.operator }
        : { field: c.dimension, operator: c.operator, type: "string", value: c.value },
    ),
    groupBy: plan.groupBy,
    visualization: plan.visualization,
    limit: plan.limit,
  };
  if (plan.variant !== null) ast.variant = plan.variant;
  if (query.filters.includeBots) ast.includeBots = true;
  if (query.filters.includeInternal) ast.includeInternal = true;
  return ast;
}

// ─────────────────────── Registre public des capacités ───────────────────────
//
// Ce que `GET /api/v1/explorer/schema` publie : des identifiants d'API et des
// libellés. Aucune table, aucune colonne, aucune valeur client, aucun secret —
// le builder d'interface et l'agent MCP n'en ont pas besoin, et un inventaire de
// valeurs transverses révélerait les releases d'un tenant à un autre.

export interface PublicField {
  id: string;
  label: string;
  unit: string;
  aggregations: Aggregation[];
  /** Agrégations additives : seules elles admettent un seau à zéro et un « Autres ». */
  additive: Aggregation[];
  /** Propriété JSON obligatoire (mesure d'un attribut déclaré). */
  requiresProperty: boolean;
  /** Sous-population imposée par la mesure. */
  variant: string | null;
  bucketable: boolean;
  notice: string | null;
}

export interface PublicDimension {
  id: Dimension;
  label: string;
  available: boolean;
  /** Pourquoi elle n'est pas disponible : sans objet ici, ou pas encore collectée. */
  reason: string | null;
}

export interface PublicDataset {
  id: ExplorerDatasetId;
  label: string;
  summary: string;
  population: string;
  variant: { id: string; label: string; values: string[]; required: boolean } | null;
  fields: PublicField[];
  dimensions: PublicDimension[];
  /** Colonnes du journal, par leur identifiant public. */
  columns: Array<{ id: string; label: string }>;
  notices: string[];
}

export interface PublicSchema {
  version: typeof EXPLORER_VERSION;
  operators: FilterOperator[];
  visualizations: Array<{ id: Visualization; label: string }>;
  limits: {
    conditions: number;
    group_by: number;
    groups: number;
    rows: number;
    body_bytes: number;
    dimension_name: number;
    value: number;
  };
  capabilities: { save_to_dashboard: boolean };
  datasets: PublicDataset[];
}

/**
 * Vue publique d'un champ. `additive` est DÉRIVÉ, pas déclaré : une agrégation
 * additive le reste quel que soit le jeu de données.
 */
function publicField(id: string, field: FieldDefinition): PublicField {
  const aggregations = [...field.aggregations];
  return {
    id,
    label: field.label,
    unit: field.unit,
    aggregations,
    additive: aggregations.filter(estAdditive),
    requiresProperty: field.kind === "json",
    variant: field.variant ?? null,
    bucketable: field.bucketable !== false,
    notice: field.notice ?? null,
  };
}

/**
 * Registre de capacités destiné au builder d'interface et à l'agent MCP.
 * `dimensionSupport` est injecté : la disponibilité d'une dimension dépend du
 * schéma réellement sondé, que ce module pur ne connaît pas.
 */
export function publicSchema(
  support: (dataset: DatasetId, dimension: Dimension) => { available: boolean; reason: string | null },
  capabilities: { saveToDashboard: boolean },
): PublicSchema {
  return {
    version: EXPLORER_VERSION,
    operators: [...FILTER_OPERATORS],
    visualizations: VISUALIZATIONS.map((id) => ({ id, label: VISUALIZATION_LABELS[id] })),
    limits: {
      conditions: MAX_CONDITIONS,
      group_by: MAX_GROUP_BY,
      groups: MAX_GROUPS,
      rows: MAX_ROWS,
      body_bytes: MAX_BODY_BYTES,
      dimension_name: DIMENSION_NAME_MAX,
      value: VALUE_MAX,
    },
    capabilities: { save_to_dashboard: capabilities.saveToDashboard },
    datasets: EXPLORER_DATASET_IDS.map((id) => {
      const definition = datasetDefinition(id);
      return {
        id,
        label: definition.label,
        summary: definition.summary,
        population: definition.population,
        variant: definition.variant
          ? {
              id: definition.variant.id,
              label: definition.variant.label,
              values: [...definition.variant.values],
              required: definition.variant.required,
            }
          : null,
        fields: Object.entries(definition.fields).map(([fieldId, field]) => publicField(fieldId, field)),
        dimensions: DIMENSIONS.map((dimension) => {
          const state = support(definition.dataset, dimension);
          return { id: dimension, label: DIMENSION_LABELS[dimension], available: state.available, reason: state.reason };
        }),
        columns: definition.rows.map((column) => ({ id: column.id, label: column.label })),
        notices: [...definition.notices],
      };
    }),
  };
}

// ──────────────────── Nombres rendus sans arrondi silencieux ─────────────────

export interface MesureNumerique {
  value: number | null;
  /** `true` : la valeur exacte dépasse l'entier sûr de JavaScript. */
  approx: boolean;
}

/**
 * Une mesure lue de PostgreSQL en `numeric` arrive en chaîne décimale EXACTE.
 * Au-delà de l'entier sûr de JavaScript, la convertir en nombre perd des unités :
 * la conversion est faite quand même — le JSON n'a pas d'autre type — mais elle
 * est SIGNALÉE, jamais silencieuse.
 */
export function mesureNumerique(raw: unknown): MesureNumerique {
  if (raw === null || raw === undefined) return { value: null, approx: false };
  const texte = typeof raw === "string" ? raw : String(raw);
  const value = Number(texte);
  if (!Number.isFinite(value)) return { value: null, approx: false };
  return { value, approx: Math.abs(value) > Number.MAX_SAFE_INTEGER };
}
