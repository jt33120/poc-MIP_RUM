// Types des paquets `@mip/backend` et `@mip/db` (JS pur, volontairement non
// typé : il est partagé avec les services Node et, historiquement, un runtime
// Deno). Ce fichier s'appelait `ingest.d.ts`, du nom de l'ancien paquet. On les déclare
// ici plutôt que de parsemer les routes de `as any` : le contrat est ainsi
// écrit UNE fois, et une évolution incompatible du module casse la compilation
// au lieu de passer inaperçue.
//
// Les lignes RUM restent volontairement `Record<string, unknown>` : leur forme
// exacte est fixée par flattenOtlp et vérifiée par les 631 tests unitaires du
// parser — la redéclarer ici en dur créerait une seconde source de vérité qui
// dériverait en silence.

declare module "@mip/backend/lib/pg-ingest.mjs" {
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

  /** Lot refusé par une barrière d'effacement (P8.1) : nombre de lignes par collection. */
  export type RefusBarriere = Record<string, number>;

  /**
   * Wrapper compatible : ouvre la transaction, verrouille la ou les apps du lot,
   * filtre par barrières, délègue. `client` permet à un appelant qui tient déjà
   * une transaction verrouillée de ne PAS en rouvrir une seconde.
   */
  export function writeRows(
    pool: Pool,
    rows: FlattenedRows,
    opts?: {
      symbolicateur?: import("@mip/backend/lib/error-symbolication.mjs").Symbolicateur | null;
      client?: PoolClient | null;
      /** Attente bornée du verrou d'application (défaut : STRATEGIE_VERROU). */
      verrou?: { delaiVerrouMs?: number; tentatives?: number };
    },
  ): Promise<{ erreurs: EcritureErreurs; refuses?: RefusBarriere }>;

  /** Écriture pure : ni begin, ni commit, ni release — l'appelant les possède. */
  export function writeRowsWithClient(
    client: PoolClient,
    rows: FlattenedRows,
  ): Promise<{ erreurs: EcritureErreurs }>;

  /** Logs et exceptions structurées qu'ils portent (P5.3), dans une transaction. */
  export function writeLogs(
    pool: Pool,
    logs: IngestRow[],
    errors?: IngestRow[],
    opts?: { client?: PoolClient | null; verrou?: { delaiVerrouMs?: number; tentatives?: number } },
  ): Promise<{ logs: number; erreurs: EcritureErreurs; refuses?: RefusBarriere }>;

  export function writeLogsWithClient(
    client: PoolClient,
    logs: IngestRow[],
    errors?: IngestRow[],
  ): Promise<{ logs: number; erreurs: EcritureErreurs }>;

  /**
   * `ecrit` : chunk stocké. `refus_barriere` : session effacée, refus définitif.
   * `attente_session` : ancre OTLP pas encore reçue et protection activée —
   * refus TEMPORAIRE, corps non persisté.
   */
  export interface ResultatReplay {
    etat: "ecrit" | "refus_barriere" | "attente_session";
    retryAfterS?: number;
  }

  export interface ChunkReplay {
    sessionId: string;
    appId: string;
    seq: number;
    body: Buffer;
    eventsCount: number;
  }

  export function writeReplayChunk(
    pool: Pool,
    chunk: ChunkReplay,
    opts?: { client?: PoolClient | null; verrou?: { delaiVerrouMs?: number; tentatives?: number } },
  ): Promise<ResultatReplay>;

  export function writeReplayChunkWithClient(
    client: PoolClient,
    chunk: ChunkReplay,
  ): Promise<ResultatReplay>;

  export function appliquerSymbolication(
    client: PoolClient,
    errors: IngestRow[],
    symbolicateur?: import("@mip/backend/lib/error-symbolication.mjs").Symbolicateur | null,
  ): Promise<IngestRow[]>;

  export interface PgAuth {
    getAppRegistry(): Promise<
      Map<string, { api_key_hash: string | null; active: boolean; allowed_origins: string[] | null }>
    >;
    /** null si accepté, sinon la raison du 403. */
    checkApiKey(appId: string, apiKey: string | null): Promise<string | null>;
    rateLimitedDurable(appId: string): Promise<boolean>;
    /** Le registre a-t-il été chargé au moins une fois ? (sinon checkApiKey est en fail-open) */
    registryLoaded(): boolean;
  }

  export function createPgAuth(
    pool: Pool,
    opts?: {
      requireApiKey?: boolean;
      rateLimitPerMin?: number;
      /** Partiel : le module n'appelle que warn/error, en optional-chaining. */
      log?: Partial<import("@mip/backend/shared/log.mjs").Logger>;
      now?: () => number;
    },
  ): PgAuth;
}

// --- Effacement sérialisé (P8.1) ---------------------------------------------
// LA primitive partagée. La console et le noyau d'ingestion doivent prendre LE
// MÊME verrou : une constante recopiée à la main dériverait en silence, et
// chacun se croirait seul.

declare module "@mip/backend/lib/privacy-barriere.mjs" {
  import type { Pool, PoolClient } from "pg";

  export const VERROU_INGESTION_NS: number;
  export const SUJETS_BARRIERE: readonly ["session", "visitor", "user", "account"];
  export type SujetBarriere = (typeof SUJETS_BARRIERE)[number];
  export const STRATEGIE_VERROU: Readonly<{
    delaiMs: number;
    tentatives: number;
    reculMs: readonly number[];
  }>;

  /** Attente de verrou épuisée : rien n'a été écrit, l'appelant peut rejouer. */
  export class ErreurVerrouIngestion extends Error {
    apps: string[];
    reessayable: true;
  }
  /** Identifiant déjà stocké sous une autre application : hors portée, non rejouable. */
  export class ErreurPorteeApp extends Error {
    reessayable: false;
  }

  export function appsDuLot(rows: Record<string, unknown>): string[];
  export function verrouillerApps(client: PoolClient, appIds: string[]): Promise<string[]>;
  export function withAppIngestTransaction<T>(
    pool: Pool,
    appId: string | string[],
    travail: (client: PoolClient) => Promise<T>,
    opts?: {
      delaiVerrouMs?: number;
      tentatives?: number;
      client?: PoolClient | null;
      /** Échéance DURE (epoch ms) — le collector seul ; la console n'en pose pas. */
      echeance?: number;
    },
  ): Promise<T>;

  /** Échéance de la requête atteinte : « annulee » = rien n'est commis. */
  export class ErreurEcheance extends Error {
    issue: "annulee" | "inconnue";
    reessayable: true;
    connexionCompromise?: boolean;
  }
  export const GRACE_COMMIT_MS: number;
  export function sousEcheance<T>(promesse: Promise<T> | T, echeance: number, siTardif?: (valeur: T) => void): Promise<T>;

  export function barrieresDisponibles(client: PoolClient): Promise<boolean>;
  export function _resetPresenceBarrieres(): void;
  export function sujetsDuLot(
    rows: Record<string, unknown>,
  ): Map<string, Record<SujetBarriere, Set<string>>>;
  export function barrieresDuLot(
    client: PoolClient,
    candidats: Map<string, Record<SujetBarriere, Set<string>>>,
  ): Promise<Map<string, Record<SujetBarriere, Set<string>>>>;
  export function filtrerLot<T extends Record<string, unknown>>(
    rows: T,
    bloques: Map<string, Record<SujetBarriere, Set<string>>>,
  ): { rows: T; refuses: Record<string, number>; total: number };
  export function filtrerParBarrieres<T extends Record<string, unknown>>(
    client: PoolClient,
    rows: T,
  ): Promise<{ rows: T; refuses: Record<string, number>; total: number }>;
  export function sessionSousBarriere(
    client: PoolClient,
    appId: string,
    sessionId: string,
  ): Promise<boolean>;
  export function barriereActivee(client: PoolClient, appId: string): Promise<boolean>;
  export function poserBarrieres(
    client: PoolClient,
    appId: string,
    genre: SujetBarriere,
    cles: string[],
    requestId?: string | null,
  ): Promise<number>;
}

declare module "@mip/backend/lib/ingest-differe.mjs" {
  import type { Pool } from "pg";
  import type { FlattenedRows } from "@mip/backend/lib/pg-ingest.mjs";

  export const MAX_TENTATIVES: number;
  export function scinderParApp(
    rows: FlattenedRows,
    appParDefaut: string,
  ): Array<[string, FlattenedRows]>;
  export function deposerLot(
    pool: Pool,
    appId: string,
    rows: FlattenedRows,
  ): Promise<{ deposes: number; refuses: number }>;
  export function drainerIngestRaw(
    pool: Pool,
    opts?: { max?: number; log?: unknown },
  ): Promise<{ drains: number; echecs: number }>;
  export function etatIngestRaw(
    pool: Pool,
  ): Promise<{ en_attente: number; bloques: number; age_max_s: number }>;
}

declare module "@mip/backend/shared/otlp.mjs" {
  import type { FlattenedRows } from "@mip/backend/lib/pg-ingest.mjs";

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

// P8.7 — pays et PROVENANCE du pays. La console ne résout aucune adresse : elle
// n'utilise de ce module que le geste qui pose la provenance sur les sessions
// d'un lot, pour que son filet d'ingestion écrive la même chose que le service.
declare module "@mip/backend/shared/geoip.mjs" {
  export const PROVENANCES: readonly ["geoip", "timezone", "cdn"];
  export function appliquerGeo(
    sessions: Record<string, unknown>[],
    source?: { geoip?: { country: string; version?: string | null } | null; cdn?: string | null },
  ): void;
}

// --- Source maps (P5.4) -------------------------------------------------------
// Un moteur, un contrat d'upload, un symbolicateur : partagés par l'ingestion,
// les deux ports d'upload, le CLI de CI et la console.

declare module "@mip/backend/shared/sourcemap.mjs" {
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

declare module "@mip/backend/lib/error-symbolication.mjs" {
  import type { ResolvedFrame } from "@mip/backend/shared/sourcemap.mjs";

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
    log?: Partial<import("@mip/backend/shared/log.mjs").Logger>;
  }): Symbolicateur;
}

declare module "@mip/backend/lib/sourcemap-upload.mjs" {
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
  export const PRIVILEGES_JETON: readonly ["sourcemaps:write", "deploys:write"];

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
  /** `Authorization: Bearer msu_…` → { id, secret }, ou null pour toute autre forme. */
  export function lireJetonUpload(authorization: string | null): { id: string; secret: string } | null;
  export function verifierJetonUpload(
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
    authorization: string | null,
    privilege?: "sourcemaps:write" | "deploys:write",
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

declare module "@mip/backend/lib/extension-parc.mjs" {
  type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
  export const LIMITES_EXTENSION: Readonly<{ resolveParMinute: number; battementsParHeure: number; corpsBattement: number }>;
  export interface Battement {
    installId: string;
    version: string | null;
    label: string | null;
    appIds: string[];
  }
  export function lireDomaine(brut: string | null): string | null;
  export function resoudreDomaine(db: Db, domaine: string): Promise<{ app_id: string; endpoint: string | null; active: boolean } | null>;
  export function lireBattement(brut: string): { battement: Battement; erreur?: undefined } | { erreur: string; statut: number; battement?: undefined };
  export function enregistrerBattement(db: Db, b: Battement, ua: string | null): Promise<void>;
  export function navigateurDe(ua: string | null): string;
  export function versionMajeureDe(ua: string | null): number | null;
  export function systemeDe(ua: string | null): string | null;
  export function creerDebitFenetre(
    limite: number,
    fenetreMs: number,
    maintenant?: () => number,
  ): { prendre(cle: string): { ok: true } | { ok: false; retryAfter: number } };
}

declare module "@mip/backend/lib/integrations/tickets/webhook-entrant.mjs" {
  import type { Pool } from "pg";
  export const COOKIE_SESSION_CONSOLE: string;
  export const CORPS_LIVRAISON_MAX: number;
  export const ENTETE_NOTIFIER: "x-mip-notifier";
  export const MOTIF_INTEGRATION: RegExp;
  export function refusAvantLecture(entetes: { get(nom: string): string | null }): { statut: number; corps: object } | null;
  export function recevoirLivraison(p: {
    pool: Pool;
    integrationId: string;
    entetes: { get(nom: string): string | null };
    brut: Uint8Array;
    env?: Record<string, string | undefined>;
    log?: { error: (...a: unknown[]) => void };
  }): Promise<{ statut: number; corps: object }>;
}

declare module "@mip/backend/lib/deploiements.mjs" {
  type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
  export const PRIVILEGE_DEPLOIEMENT: "deploys:write";
  export const FIN_JETONS_HISTORIQUES: string;
  export const CORPS_DEPLOIEMENT_MAX: number;
  export const REFUS_DEPLOIEMENT: Readonly<{
    sansJeton: string;
    jetonInvalide: string;
    tropGros: string;
    horsPerimetre: (app: string) => string;
  }>;
  export interface Deploiement {
    appId: string;
    version: string | null;
    env: string;
    ts: Date | null;
  }
  export function lireDeploiement(corps: unknown): { deploiement: Deploiement; erreur?: undefined } | { erreur: string; deploiement?: undefined };
  export function enregistrerDeploiement(db: Db, d: Deploiement, source: "ci" | "manual"): Promise<void>;
}

declare module "@mip/backend/shared/cors.mjs" {
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

declare module "@mip/backend/shared/limits.mjs" {
  export const MAX_BODY_BYTES: number;
  export const MAX_SPANS_PER_REQUEST: number;
  export const MAX_REPLAY_INFLATED_BYTES: number;
  export const MAX_REPLAY_BYTES: number;
  /** `x-mip-seq` → entier ≥ 0 dans l'int4 de la colonne, sinon null (400). */
  export function lireSequenceReplay(brut: string | null | undefined): number | null;
  export function bodyTooLarge(
    contentLength: string | number | null | undefined,
    max?: number,
  ): boolean;
  /** Corps lu en bornant la mémoire : null au premier octet au-delà de `max`. */
  export function lireCorpsBorne(
    flux: AsyncIterable<Uint8Array> | null | undefined,
    max?: number,
  ): Promise<Buffer | null>;
}

// P7.5 — vocabulaire FERMÉ des capacités mobiles. Le module serveur fait
// autorité à réception ; la console le lit tel quel plutôt que d'en recopier la
// liste, qui dériverait.
declare module "@mip/backend/shared/mobile-capabilities.mjs" {
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

declare module "@mip/backend/shared/log.mjs" {
  export interface Logger {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  }
  export function createLogger(service: string): Logger;
}

declare module "@mip/backend/shared/retry.mjs" {
  export function isTransient(err: unknown): boolean;
  /** Panne de base qui vaut « rejoue plus tard » : 503 + retry-after sur les ports d'ingestion. */
  export function estIndisponibilite(err: unknown): boolean;
  export function withRetry<T>(
    fn: () => Promise<T>,
    opts?: {
      attempts?: number;
      onRetry?: (err: unknown, attempt: number, delay: number) => void;
    },
  ): Promise<T>;
}

declare module "@mip/backend/lib/dispatch-alerts.mjs" {
  import type { Pool } from "pg";

  /** Statut résultant d'une tentative de livraison (logique pure). */
  export function decideStatus(
    ok: boolean,
    attemptsBefore: number,
    maxAttempts?: number,
  ): "delivered" | "failed" | "dead";

  /**
   * Poste les livraisons 'queued' + les 'failed' rééligibles ; met à jour leur
   * statut. `fetchImpl` vaut `safeFetch` : une cible refusée est soldée `skipped`.
   */
  export function dispatchOnce(
    pool: Pool,
    opts?: { lot?: number; budgetMs?: number; echeance?: number; fetchImpl?: typeof fetch },
  ): Promise<{ sent: number; failed: number; dead: number; skipped: number }>;
}

// P1 — sorties HTTP vers une URL saisie par un utilisateur (uptime, webhooks).
// La console n'en appelle que la partie SANS RÉSEAU, à l'écriture : un message
// clair au lieu d'un refus muet au premier tick du scheduler.
declare module "@mip/backend/lib/net/safe-fetch.mjs" {
  export type CodeRefus =
    | "url_invalide"
    | "protocole"
    | "identifiants"
    | "ip_litterale"
    | "hote_interne"
    | "adresse_interdite"
    | "redirections";

  export const MAX_REDIRECTIONS: number;
  export const TIMEOUT_DEFAUT_MS: number;
  export const CORPS_MAX_OCTETS: number;
  export const MOTIFS_REFUS: Readonly<Record<CodeRefus, string>>;

  /** Le texte d'un code de refus ; null pour un code inconnu (jamais d'écho brut). */
  export function motifDeRefus(code: unknown): string | null;

  export class ErreurCibleRefusee extends Error {
    readonly code: CodeRefus;
    readonly detail: string | null;
    constructor(code: CodeRefus, detail?: string | null);
  }

  /** Pourquoi une adresse IP est interdite comme destination, ou null si elle est publique. */
  export function motifAdresseInterdite(adresse: string): string | null;

  /** Contrôle SANS RÉSEAU d'une URL sortante (celui de l'écriture). */
  export function verifierUrlSortante(
    texte: unknown,
  ): { ok: true; url: URL } | { ok: false; code: CodeRefus; message: string };

  export interface OptionsResolution {
    resoudre?: (nom: string) => Promise<Array<{ address: string; family?: number } | string>>;
    adresseRefusee?: (adresse: string) => string | null;
    signal?: AbortSignal;
  }

  /** Contrôle complet : l'URL, puis chaque adresse résolue. */
  export function verifierCible(
    texte: string | URL,
    options?: OptionsResolution,
  ): Promise<{ url: URL; adresses: Array<{ address: string; family: 4 | 6 }> }>;

  /** `fetch` restreint aux destinations publiques, connexion épinglée, 3 redirections revalidées. */
  export function safeFetch(
    entree: string | URL,
    options?: OptionsResolution & {
      method?: string;
      headers?: HeadersInit;
      body?: string | Uint8Array | ArrayBuffer | URLSearchParams | null;
      timeoutMs?: number;
      redirect?: "follow" | "manual";
      maxCorpsOctets?: number;
    },
  ): Promise<Response>;
}

declare module "@mip/backend/lib/error-issue-workflow.mjs" {
  import type { Pool, PoolClient } from "pg";

  export const COMMENTAIRE_MAX: number;
  /**
   * Release et env de la dernière occurrence d'une issue — la référence contre
   * laquelle une régression se jugera. Partagée depuis P8.6 : un fournisseur de
   * tickets peut résoudre une issue par webhook, et deux copies auraient donné
   * deux verdicts de régression selon qui l'a fermée.
   */
  export const SQL_REFERENCE_RESOLUTION: string;
  export function referenceResolution(
    client: PoolClient,
    appId: string,
    issueId: string,
  ): Promise<{ release: string | null; env: string | null }>;
  /** Texte scrubbé, sans NUL, espaces de bord retirés ; null s'il ne reste rien. */
  export function texteActivite(texte: unknown): string | null;
  export function tronquerCaracteres(texte: string, max: number): string;
  /** En-tête d'une note héritée d'un groupe historique SCINDÉ entre plusieurs issues (P8.2). */
  export function ENTETE_HERITEE(empreinte: string, issues: number): string;
  export function importerNotesHistoriques(
    pool: Pool,
    opts?: { limite?: number },
  ): Promise<{ importees: number; heritees: number } | { absent: string }>;
}

// --- Travaux planifiés (packages/backend/jobs) ------------------------------------
// Ils vivaient dans les route handlers `app/api/cron/*` ; ils sont descendus
// dans le noyau pour que le service `scheduler` (Railway) et ces routes
// exécutent LE MÊME code. Une divergence entre les deux ne serait pas visible :
// les deux « marchent », mais ne font pas la même chose.

declare module "@mip/backend/jobs/planifie.mjs" {
  import type { Pool } from "pg";

  export interface BilanEtapes {
    ok: boolean;
    echecs: number;
    resultats: Record<string, unknown>;
  }

  export function executerEtapes(
    etapes: Array<{ name: string; run: () => Promise<unknown>; delaiMs?: number }>,
    log?: unknown,
    contexte?: { job?: string },
  ): Promise<BilanEtapes>;

  /** Délai serveur (statement_timeout) par étape SQL, en ms (P1). */
  export const DELAI_ETAPE_DEFAUT_MS: number;
  export const DELAIS_ETAPES_MS: Readonly<Record<string, number>>;
  export const MARGE_CLIENT_MS: number;
  export function delaiEtape(nom: string): number;

  /** Avec `delaiMs` : set_config('statement_timeout', …, true) puis l'appel, en une transaction. */
  export function appelerFn(pool: Pool, fn: string, opts?: { delaiMs?: number }): Promise<unknown>;

  /** Sondes uptime menées de front, au plus. */
  export const CONCURRENCE_UPTIME: number;
  /** Pause avant l'essai de confirmation d'une sonde en échec. */
  export const PAUSE_CONFIRMATION_MS: number;

  export interface VerdictSonde {
    ok: boolean;
    statut: number | null;
    erreur: string | null;
    ms: number;
    /** Refus de politique : pas de second essai. */
    definitif: boolean;
  }

  export function sonderUneFois(
    check: { url: string; method?: string | null; expect_status?: number | null; timeout_ms?: number | null },
    opts?: { fetchImpl?: (url: string, init: { method: string; timeoutMs: number }) => Promise<Response> },
  ): Promise<VerdictSonde>;

  /** Concurrence bornée ; une sonde en échec est confirmée par un second essai avant DOWN. */
  export function sonderUptime(
    pool: Pool,
    log?: unknown,
    opts?: { sonder?: (check: unknown) => Promise<VerdictSonde>; concurrence?: number; pauseMs?: number },
  ): Promise<{ ran: number; down: number; rattrapes: number }>;

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

declare module "@mip/backend/jobs/cadence.mjs" {
  export const CADENCES: Record<"tick" | "horaire" | "quotidien", string>;
  /** Silence au-delà duquel une cadence est en retard (/ready, /metrics — jamais /health). */
  export const TOLERANCES_MS: Readonly<Record<"tick" | "horaire" | "quotidien", number>>;
  export function prochainDelai(
    nom: "tick" | "horaire" | "quotidien",
    maintenant: number | Date,
  ): number;
}

declare module "@mip/db/migrate.mjs" {
  import type { Pool } from "pg";

  type Delais = {
    lockTimeoutMs: number;
    indexLockTimeoutMs: number;
    tentatives: number;
    attenteMs: number;
    verrouEssais: number;
    verrouPauseMs: number;
  };
  type Journal = {
    info(msg: string, champs?: Record<string, unknown>): void;
    warn(msg: string, champs?: Record<string, unknown>): void;
    error(msg: string, champs?: Record<string, unknown>): void;
  };

  export const DOSSIER_SQL: string;
  export const DELAIS: Readonly<Delais>;
  export function empreinte(sql: string): string;
  export function estAttenteDeVerrou(err: unknown): boolean;
  export function numeroMigration(nom: string): number | null;
  export function trierMigrations(noms: string[]): string[];
  export function fichiersMigration(dossier?: string): Promise<string[]>;
  export function fichiersPredeploiement(dossier?: string): Promise<Map<number, string[]>>;
  export function decouperSql(sql: string): string[];
  export function indexConcurrent(instruction: string): { nom: string; cite: string } | null;
  export function estPooler(url: string): boolean;
  export function aFaire(
    fichiers: Array<{ nom: string; checksum: string }>,
    dejaApplique: Array<{ filename: string; checksum: string }>,
  ): { enAttente: Array<{ nom: string; checksum: string }>; modifies: string[] };
  export function jusquaInclus<T extends { nom: string }>(fichiers: T[], jusqua: string): T[] | null;
  export function migrer(
    pool: Pool,
    opts?: {
      dossier?: string;
      baseline?: string | null;
      par?: string;
      ouvrirDirecte?: null | (() => Promise<unknown>);
      delais?: Partial<Delais>;
      journal?: Journal;
      attendre?: (ms: number) => Promise<unknown>;
    },
  ): Promise<{ appliquees: string[]; modifies: string[]; total: number; predeployes: string[] }>;
  export function main(options?: {
    argv?: string[];
    env?: Record<string, string | undefined>;
    dossier?: string;
  }): Promise<number>;
}

declare module "@mip/backend/lib/serveur.mjs" {
  /** undefined = pas de TLS imposé ; sinon TLS vérifié contre le magasin CA système. */
  export function optionsSsl(connectionString: string): undefined | { rejectUnauthorized: true };
  export function cible(connectionString?: string): Record<string, string>;
}

declare module "@mip/backend/jobs/bail.mjs" {
  /** Bail d'exclusion : une ligne à date d'expiration, pooler-safe. */
  export const SQL_TABLE: string;
  export const DUREES: Record<"tick" | "horaire" | "quotidien", number>;
  export function prendreBail(
    client: unknown,
    opts: { job: string; porteur: string; secondes: number },
  ): Promise<boolean>;
  /** La prise, plus le battement qu'elle remplace (pour `abandonnerBail`). */
  export function prendreBailDetaille(
    client: unknown,
    opts: { job: string; porteur: string; secondes: number },
  ): Promise<{ tenu: boolean; battementPrecedent: Date | null }>;
  /** Reddition sur SUCCÈS : la ligne expire à now(), c'est le battement. */
  export function rendreBail(
    client: unknown,
    opts: { job: string; porteur: string },
  ): Promise<void>;
  /** Reddition après un ÉCHEC : l'ancien battement est remis (ou la ligne supprimée). */
  export function abandonnerBail(
    client: unknown,
    opts: { job: string; porteur: string; battement: Date | null },
  ): Promise<void>;
}

// --- Connecteur de tickets (P8.6) --------------------------------------------
// L'interface est écrite une fois ici pour que la console ne puisse pas appeler
// un adaptateur autrement que par son contrat. GitHub Issues est l'unique
// implémentation de ce lot ; la cible reste l'outil ITSM de MIP (ServiceNow,
// sous réserve de confirmation).

declare module "@mip/backend/lib/integrations/tickets/adapter.mjs" {
  export const PROVIDERS: string[];
  export const TITRE_MAX: number;
  export const DESCRIPTION_MAX: number;
  export const MESSAGE_MAX: number;
  /** « GitHub aujourd'hui, ITSM MIP demain », en une seule définition. */
  export const MENTION_ETAPE: string;
  export const REFERENCE_PREFIXE: string;
  export const CODES: Record<string, string>;
  export const STRATEGIE: { baseMs: number; plafondMs: number; tentativesMax: number };

  export class ErreurTicket extends Error {
    constructor(
      code: string,
      options?: { rejouable?: boolean; incertain?: boolean; degrade?: boolean; attendreSec?: number | null },
    );
    code: string;
    rejouable: boolean;
    incertain: boolean;
    degrade: boolean;
    attendreSec: number | null;
  }

  export interface ChargeTicket {
    titre: string;
    description: string;
    url: string;
    reference: string;
  }

  export interface EtatIssuePourTicket {
    issueId: string;
    appId: string;
    errorType: string | null;
    message: string | null;
    firstRelease: string | null;
    lastRelease: string | null;
    /** null = inconnu (jamais 0 à la place d'une inconnue). */
    occurrences: number | null;
    firstSeen: Date | string | null;
    lastSeen: Date | string | null;
  }

  export function referenceMip(issueId: string): string;
  export function prochaineTentative(
    tentatives: number,
    opts?: { attendreSec?: number | null; maintenant?: number },
  ): number;
  export function tronquer(texte: string, max: number): string;
  /** Le contenu EXACT d'un ticket : aperçu admin et charge figée viennent d'ici. */
  export function construireCharge(issue: EtatIssuePourTicket, ctx: { consoleBase: string }): ChargeTicket;
  export function urlConsole(issue: { issueId: string; appId: string }, consoleBase: string): string;
  export function egalTempsConstant(a: Uint8Array, b: Uint8Array): boolean;
  export function octetsHex(hex: string): Uint8Array | null;
  export function statutPropose(
    evenement: { action: string; etat: string },
    mapping: { closed?: string | null; reopened?: string | null },
    statutActuel: string,
  ): { statut: string } | { statut: null; raison: string };
  export function mappingStatut(config: unknown): { closed: string | null; reopened: string | null };
}

declare module "@mip/backend/lib/integrations/tickets/github.mjs" {
  import type { ChargeTicket } from "@mip/backend/lib/integrations/tickets/adapter.mjs";

  export const PROVIDER: string;
  export const WEBHOOK_MAX_OCTETS: number;

  export interface TicketDistant {
    externalId: string;
    url: string;
    etat: "open" | "closed" | "unknown";
  }

  export interface EvenementNormalise {
    provider: string;
    deliveryId: string;
    type: string;
    action: string;
    externalId: string | null;
    etat: "open" | "closed" | "unknown";
    cible: string | null;
  }

  export function createIssue(params: {
    cible: string;
    secret: string;
    charge: ChargeTicket;
    labels?: string[];
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  }): Promise<TicketDistant>;

  export function getIssue(params: {
    cible: string;
    secret: string;
    externalId: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  }): Promise<TicketDistant>;

  export function chercherParReference(params: {
    cible: string;
    secret: string;
    reference: string;
    depuis?: Date | string | null;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  }): Promise<{ concluante: true; trouve: TicketDistant | null } | { concluante: false; raison: string }>;

  export function validateWebhook(params: {
    secret: string;
    entetes: Headers | Record<string, string>;
    corps: Uint8Array;
  }): { ok: true; deliveryId: string; type: string } | { ok: false; raison: string };

  export function normalizeWebhook(params: {
    entetes: Headers | Record<string, string>;
    corps: unknown;
  }): EvenementNormalise;

  export const adaptateur: {
    provider: string;
    createIssue: typeof createIssue;
    getIssue: typeof getIssue;
    chercherParReference: typeof chercherParReference;
    validateWebhook: typeof validateWebhook;
    normalizeWebhook: typeof normalizeWebhook;
  };
  export default adaptateur;
}

declare module "@mip/backend/lib/integrations/tickets/secrets.mjs" {
  export class ErreurSecret extends Error {
    constructor(code: string);
    code: string;
  }
  /** Préfixe obligatoire d'une variable référencée : `env:TICKET_…`. */
  export const PREFIXE_VARIABLE: "TICKET_";
  /** `env:TICKET_NOM` (hors noms réservés) ou `enc:v1:…` — jamais un secret en clair. */
  export function referenceValide(ref: unknown): boolean;
  export function decrire(ref: unknown): { kind: "env"; name: string } | { kind: "encrypted" } | { kind: "invalid" };
  export function chiffrer(secret: string, env?: NodeJS.ProcessEnv): string;
  export function resoudre(ref: string, env?: NodeJS.ProcessEnv): string;
}

declare module "@mip/backend/lib/integrations/tickets/dispatcher.mjs" {
  import type { Pool, PoolClient } from "pg";
  import type { EvenementNormalise, adaptateur } from "@mip/backend/lib/integrations/tickets/github.mjs";

  export function adaptateurDe(provider: string): typeof adaptateur | null;
  export function schemaPresent(pool: Pool): Promise<boolean>;

  export function livrerTickets(
    pool: Pool,
    options?: {
      limite?: number;
      echeance?: number;
      fetchImpl?: typeof fetch;
      env?: NodeJS.ProcessEnv;
      maintenant?: number;
      /** Délai d'attente par APPEL distant (un signal neuf à chaque requête). */
      timeoutMs?: number;
      log?: Pick<Console, "error">;
    },
  ): Promise<
    | { absent: string }
    | { reservees: number; envoyes: number; rejouables: number; echecs: number; incertaines: number }
  >;

  /** Applique un événement DÉJÀ vérifié ; ne décide rien du mapping, il est configuré. */
  export function appliquerEvenement(
    client: PoolClient,
    params: {
      integration: { id: string; app_id: string; provider: string; target: string; config: unknown };
      evenement: EvenementNormalise;
      deliveryId: string;
    },
  ): Promise<{ status: string; issueId?: string; statut?: string }>;
}
