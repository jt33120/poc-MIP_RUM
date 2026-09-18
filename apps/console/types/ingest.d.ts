// Types du paquet `ingest` (JS pur, volontairement non typé : il est partagé
// avec le dev-server Node et, historiquement, un runtime Deno). On les déclare
// ici plutôt que de parsemer les routes de `as any` : le contrat est ainsi
// écrit UNE fois, et une évolution incompatible du module casse la compilation
// au lieu de passer inaperçue.
//
// Les lignes RUM restent volontairement `Record<string, unknown>` : leur forme
// exacte est fixée par flattenOtlp et vérifiée par les 631 tests unitaires du
// parser — la redéclarer ici en dur créerait une seconde source de vérité qui
// dériverait en silence.

declare module "ingest/lib/pg-ingest.mjs" {
  import type { Pool, PoolClient } from "pg";

  export type IngestRow = Record<string, unknown>;

  /** Lot OTLP aplati (sortie de flattenOtlp). */
  export interface FlattenedRows {
    sessions: IngestRow[];
    pageviews: IngestRow[];
    metrics: IngestRow[];
    errors: IngestRow[];
    resources: IngestRow[];
    longtasks: IngestRow[];
    breadcrumbs: IngestRow[];
    events: IngestRow[];
    spans: IngestRow[];
    sviCalls?: IngestRow[];
    sviSteps?: IngestRow[];
    sviLegs?: IngestRow[];
  }

  export function batchInsert(
    client: PoolClient,
    table: string,
    cols: string[],
    rows: IngestRow[],
    conflictClause: string,
  ): Promise<unknown>;

  /** Erreurs d'un lot : reçues, RÉELLEMENT insérées (RETURNING), ignorées avant v70. */
  export interface EcritureErreurs {
    recues: number;
    inserees: number;
    ignorees: number;
  }

  export function writeRows(
    pool: Pool,
    rows: FlattenedRows,
    opts?: { symbolicateur?: import("ingest/lib/error-symbolication.mjs").Symbolicateur },
  ): Promise<{ erreurs: EcritureErreurs }>;

  /** Logs et exceptions structurées qu'ils portent (P5.3), dans une transaction. */
  export function writeLogs(
    pool: Pool,
    logs: IngestRow[],
    errors?: IngestRow[],
  ): Promise<{ logs: number; erreurs: EcritureErreurs }>;

  export function writeReplayChunk(
    pool: Pool,
    chunk: {
      sessionId: string;
      appId: string;
      seq: number;
      body: Buffer;
      eventsCount: number;
    },
  ): Promise<void>;

  export interface PgAuth {
    getAppRegistry(): Promise<
      Map<string, { api_key_hash: string | null; active: boolean; allowed_origins: string[] | null }>
    >;
    /** null si accepté, sinon la raison du 403. */
    checkApiKey(appId: string, apiKey: string | null): Promise<string | null>;
    rateLimitedDurable(appId: string): Promise<boolean>;
  }

  export function createPgAuth(
    pool: Pool,
    opts?: {
      requireApiKey?: boolean;
      rateLimitPerMin?: number;
      /** Partiel : le module n'appelle que warn/error, en optional-chaining. */
      log?: Partial<import("ingest/shared/log.mjs").Logger>;
      now?: () => number;
    },
  ): PgAuth;
}

declare module "ingest/shared/otlp.mjs" {
  import type { FlattenedRows } from "ingest/lib/pg-ingest.mjs";

  export interface ApiKeyRef {
    app_id: string;
    api_key: string | null;
  }

  export function flattenOtlp(
    payload: unknown,
    opts?: { maxSpans?: number },
  ): FlattenedRows & { apiKeys: ApiKeyRef[]; rejected: number };

  export function flattenOtlpLogs(
    payload: unknown,
    opts?: { maxLogs?: number },
  ): {
    logs: Record<string, unknown>[];
    /** Exceptions structurées dérivées des logs ERROR ou plus (P5.3). */
    errors: Record<string, unknown>[];
    apiKeys: ApiKeyRef[];
    rejected: number;
  };
}

// --- Source maps (P5.4) -------------------------------------------------------
// Un moteur, un contrat d'upload, un symbolicateur : partagés par l'ingestion,
// les deux ports d'upload, le CLI de CI et la console.

declare module "ingest/shared/sourcemap.mjs" {
  /** Source map v3 telle que parsée depuis son JSON. */
  export interface RawSourceMap {
    version: number;
    sources: (string | null)[];
    names?: string[];
    mappings: string;
    sourceRoot?: string | null;
    sourcesContent?: (string | null)[] | null;
    file?: string | null;
  }

  export interface OrigPos {
    source: string | null;
    line: number | null; // 1-based (présentation)
    column: number | null; // 0-based (comme la spec)
    name: string | null;
  }

  export interface StackFrame {
    fn: string | null;
    file: string;
    line: number;
    col: number;
  }

  export interface SourceMapConsumer {
    /** Mémoire retenue, en octets. */
    bytes: number;
    originalPositionFor(genLine1: number, genCol0: number): OrigPos;
  }

  /** Frame résolue : ligne de la stack, bundle d'origine et position source. */
  export interface ResolvedFrame {
    index: number;
    bundle: string;
    source: string;
    line: number;
    column: number;
    name: string | null;
  }

  export interface CodeContext {
    source: string;
    line: number;
    start: number;
    lines: string[];
  }

  export function hasControlCharacters(texte: string): boolean;
  export function createConsumer(map: RawSourceMap, opts?: { strict?: boolean }): SourceMapConsumer;
  export function parseStackLine(line: string): StackFrame | null;
  export function symbolicateStack(
    stack: string,
    maps: Record<string, RawSourceMap>,
  ): { stack: string; resolved: number };
  export function codeContext(map: RawSourceMap, source: string, line: number, radius?: number): CodeContext | null;
}

declare module "ingest/lib/error-symbolication.mjs" {
  import type { ResolvedFrame } from "ingest/shared/sourcemap.mjs";

  export type SymbolicationStatus = "pending" | "resolved" | "unavailable" | "failed";

  export interface SymbolicationResult {
    status: SymbolicationStatus;
    /** Stack réécrite et rescrubbée ; null si aucune frame n'est résolue. */
    stack: string | null;
    /** Diagnostic lisible quand la stack n'est pas résolue. */
    raison: string | null;
    positions: ResolvedFrame[];
  }

  export interface Symbolicateur {
    symboliquerLot(
      db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
      erreurs: Array<{ app_id?: string | null; release?: string | null; stack?: string | null }>,
      opts?: { checksum?: boolean },
    ): Promise<(SymbolicationResult | null)[]>;
    etat(): { entrees: number; octets: number; negatifs: number };
  }

  export function creerSymbolicateur(options?: {
    limites?: Record<string, number>;
    maintenant?: () => number;
    log?: Partial<import("ingest/shared/log.mjs").Logger>;
  }): Symbolicateur;
}

declare module "ingest/lib/sourcemap-upload.mjs" {
  import type { Pool } from "pg";

  export const LIMITES_UPLOAD: Readonly<{
    corpsDirect: number;
    corpsConsole: number;
    map: number;
    maps: number;
    lotConsole: number;
    delaiCorpsMs: number;
    delaiInactiviteMs: number;
    parMinute: number;
    simultanesParCle: number;
    simultanes: number;
  }>;
  export const EXPIRATION_JETON: Readonly<{ min: number; max: number; defaut: number }>;
  export const PRIVILEGE_JETON: "sourcemaps:write";

  export class ErreurUpload extends Error {
    statut: number;
    constructor(statut: number, message: string);
  }

  export interface MapValidee {
    filename: string;
    content: string;
    octets: number;
    checksum: string;
  }

  export function empreinteManifeste(entrees: Array<{ filename: string; checksum: string | null }>): string;
  export function genererJetonUpload(): { id: string; jeton: string; empreinte: string };
  export function verifierJetonUpload(
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
    authorization: string | null,
  ): Promise<{ id: string; app_id: string } | null>;
  export function creerLimiteurUpload(opts?: {
    parMinute?: number;
    simultanesParCle?: number;
    simultanes?: number;
    maintenant?: () => number;
  }): {
    prendre(cle: string): { refus: { message: string; retryAfter: number } } | { liberer: () => void };
  };
  export function lireCorpsLimite(
    flux: AsyncIterable<Uint8Array | string>,
    opts: { max: number; delaiMs?: number; delaiInactiviteMs?: number },
  ): Promise<Buffer>;
  export function lireRequeteUpload(corps: Buffer | string): {
    appId: string;
    release: string;
    remplacer: boolean;
    maps: MapValidee[];
  };
  export function enregistrerMaps(
    pool: Pool,
    demande: {
      appId: string;
      release: string;
      maps: MapValidee[];
      remplacer?: boolean;
      par: string;
      jetonId?: string | null;
    },
  ): Promise<{ statut: number; corps: Record<string, unknown> }>;
}

declare module "ingest/shared/cors.mjs" {
  export const STATIC_ALLOWED_ORIGINS: string[];
  export const REPLAY_ALLOW_HEADERS: string;
  export function isAllowedOrigin(origin: string, extraOrigins?: string[]): boolean;
  export function corsHeaders(
    origin: string,
    extraOrigins?: string[],
    opts?: { allowHeaders?: string },
  ): Record<string, string>;
  export function originsFromRegistry(registryValues: Iterable<unknown>): string[];
}

declare module "ingest/shared/limits.mjs" {
  export const MAX_BODY_BYTES: number;
  export const MAX_SPANS_PER_REQUEST: number;
  export function bodyTooLarge(
    contentLength: string | number | null | undefined,
    max?: number,
  ): boolean;
}

// P7.5 — vocabulaire FERMÉ des capacités mobiles. Le module serveur fait
// autorité à réception ; la console le lit tel quel plutôt que d'en recopier la
// liste, qui dériverait.
declare module "ingest/shared/mobile-capabilities.mjs" {
  export const MOBILE_CAPABILITIES: readonly [
    "js_errors",
    "native_crashes",
    "anr",
    "native_start",
    "offline_persistence",
    "screen_tracking",
  ];
  export const MOBILE_CAPABILITY_STATES: readonly ["active", "unavailable"];
  export const MOBILE_RUNTIMES: readonly ["react_native"];
  export const CAPABILITY_ATTRIBUTE: string;
  export const CAPABILITY_DECLARATION_MAX: number;
  export function isMobileCapability(value: unknown): boolean;
  export function isMobileRuntime(value: unknown): boolean;
  export function parseCapabilityDeclaration(
    raw: unknown,
  ): { capability: string; declared: boolean }[];
  export function formatCapabilityDeclaration(etats: Record<string, boolean>): string;
  export function capabilityRows(entree: {
    appId: string;
    runtime: string | null;
    release: string | null;
    raw: unknown;
  }): { app_id: string; runtime: string; release: string | null; capability: string; declared: boolean }[];
}

declare module "ingest/shared/log.mjs" {
  export interface Logger {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  }
  export function createLogger(service: string): Logger;
}

declare module "ingest/shared/retry.mjs" {
  export function withRetry<T>(
    fn: () => Promise<T>,
    opts?: {
      attempts?: number;
      onRetry?: (err: unknown, attempt: number, delay: number) => void;
    },
  ): Promise<T>;
}

declare module "ingest/dispatch-alerts.mjs" {
  import type { Pool } from "pg";

  /** Statut résultant d'une tentative de livraison (logique pure). */
  export function decideStatus(
    ok: boolean,
    attemptsBefore: number,
    maxAttempts?: number,
  ): "delivered" | "failed" | "dead";

  /** Poste les livraisons 'queued' + les 'failed' rééligibles ; met à jour leur statut. */
  export function dispatchOnce(
    pool: Pool,
    opts?: { lot?: number; budgetMs?: number; echeance?: number },
  ): Promise<{ sent: number; failed: number; dead: number; skipped: number }>;
}

declare module "ingest/lib/error-issue-workflow.mjs" {
  import type { Pool } from "pg";

  export const COMMENTAIRE_MAX: number;
  /** Texte scrubbé, sans NUL, espaces de bord retirés ; null s'il ne reste rien. */
  export function texteActivite(texte: unknown): string | null;
  export function tronquerCaracteres(texte: string, max: number): string;
  export function importerNotesHistoriques(
    pool: Pool,
    opts?: { limite?: number },
  ): Promise<{ importees: number } | { absent: string }>;
}

// --- Travaux planifiés (apps/ingest/jobs) ------------------------------------
// Ils vivaient dans les route handlers `app/api/cron/*` ; ils sont descendus
// dans le noyau pour que le service `scheduler` (Railway) et ces routes
// exécutent LE MÊME code. Une divergence entre les deux ne serait pas visible :
// les deux « marchent », mais ne font pas la même chose.

declare module "ingest/jobs/planifie.mjs" {
  import type { Pool } from "pg";

  export interface BilanEtapes {
    ok: boolean;
    echecs: number;
    resultats: Record<string, unknown>;
  }

  export function executerEtapes(
    etapes: Array<{ name: string; run: () => Promise<unknown> }>,
    log?: unknown,
  ): Promise<BilanEtapes>;

  export function appelerFn(pool: Pool, fn: string): Promise<unknown>;

  export function sonderUptime(pool: Pool, log?: unknown): Promise<{ ran: number; down: number }>;

  /** Délai, depuis le début d'un tick, au-delà duquel aucune livraison n'est entamée. */
  export const ECHEANCE_LIVRAISON_MS: number;

  export function travaux(
    pool: Pool,
    opts?: { log?: unknown; dispatch?: ((pool: Pool, opts: { echeance: number }) => Promise<unknown>) | null },
  ): {
    tick(): Promise<BilanEtapes>;
    horaire(): Promise<BilanEtapes>;
    quotidien(): Promise<BilanEtapes>;
  };
}

declare module "ingest/jobs/cadence.mjs" {
  export const CADENCES: Record<"tick" | "horaire" | "quotidien", string>;
  export function prochainDelai(
    nom: "tick" | "horaire" | "quotidien",
    maintenant: number | Date,
  ): number;
}

declare module "ingest/migrate.mjs" {
  import type { Pool } from "pg";

  export const DOSSIER_SQL: string;
  export function empreinte(sql: string): string;
  export function fichiersMigration(dossier?: string): Promise<string[]>;
  export function aFaire(
    fichiers: Array<{ nom: string; checksum: string }>,
    dejaApplique: Array<{ filename: string; checksum: string }>,
  ): { enAttente: Array<{ nom: string; checksum: string }>; modifies: string[] };
  export function jusquaInclus<T extends { nom: string }>(fichiers: T[], jusqua: string): T[] | null;
  export function migrer(
    pool: Pool,
    opts?: { dossier?: string; baseline?: string | null; par?: string },
  ): Promise<{ appliquees: string[]; modifies: string[]; total: number }>;
}

declare module "ingest/lib/serveur.mjs" {
  /** undefined = pas de TLS imposé ; sinon TLS vérifié contre le magasin CA système. */
  export function optionsSsl(connectionString: string): undefined | { rejectUnauthorized: true };
  export function cible(connectionString?: string): Record<string, string>;
}

declare module "ingest/jobs/bail.mjs" {
  /** Bail d'exclusion : une ligne à date d'expiration, pooler-safe. */
  export const SQL_TABLE: string;
  export const DUREES: Record<"tick" | "horaire" | "quotidien", number>;
  export function prendreBail(
    client: unknown,
    opts: { job: string; porteur: string; secondes: number },
  ): Promise<boolean>;
  export function rendreBail(
    client: unknown,
    opts: { job: string; porteur: string },
  ): Promise<void>;
}
