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

  export function writeRows(pool: Pool, rows: FlattenedRows): Promise<void>;

  export function writeLogs(pool: Pool, logs: IngestRow[]): Promise<void>;

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
  ): { logs: Record<string, unknown>[]; apiKeys: ApiKeyRef[]; rejected: number };
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
  ): Promise<{ sent: number; failed: number; dead: number }>;
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

  export function travaux(
    pool: Pool,
    opts?: { log?: unknown; dispatch?: ((pool: Pool) => Promise<unknown>) | null },
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
