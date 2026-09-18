// Cœur PUR de l'agent Node (aucun import node:*, aucun global runtime) — config,
// parsing traceparent/tracestate W3C, normalisation de route, et encodage OTLP.
// Isolé du runtime (register.ts) pour être typecheckable et testé unitairement
// (round-trip contre flattenOtlp). L'agent émet un span `http.server` au FORMAT
// attendu par l'ingestion (mêmes attributs que le middleware) : trace_id/span_id
// en attributs mip.*, durée en http.duration_ms.

export interface AgentConfig {
  enabled: boolean;
  endpoint: string;
  appId: string;
  apiKey: string | null;
  env: string;
  service: string;
  /** Intervalle d'envoi par lot ; 0 = aucun timer périodique. */
  flushMs: number;
  /** Plafond de chaque file mémoire (spans, logs). Au-delà : le plus ancien part. */
  maxQueue: number;
  /** Pont de journalisation actif. */
  logs: boolean;
  logLevel: LogLevel;
  logsEndpoint: string;
  /** Budget d'un flush d'arrêt (SIGTERM, shutdown). Borné par construction. */
  shutdownTimeoutMs: number;
}

/**
 * Entier positif lu dans l'environnement ou une option, sinon le défaut.
 *
 * Une variable ABSENTE ou vide vaut « non configuré », pas zéro : `Number("")`
 * rend 0, ce qui transformerait silencieusement chaque défaut en « pas de
 * timer » et « budget d'envoi nul ». Zéro reste une valeur valide, mais seulement
 * quand l'exploitant l'a réellement écrite.
 */
export function positiveNumber(raw: unknown, defaut: number, max: number): number {
  if (raw === null || raw === undefined) return defaut;
  const texte = typeof raw === "number" ? raw : String(raw).trim();
  if (texte === "") return defaut;
  const n = Number(texte);
  if (!Number.isFinite(n) || n < 0) return defaut;
  return Math.min(Math.floor(n), max);
}

/** Construit la config depuis l'environnement. Désactivé si endpoint/app_id manquent. */
export function buildConfig(env: Record<string, string | undefined>): AgentConfig {
  const endpoint = (env.MIP_RUM_ENDPOINT ?? "").trim();
  const appId = (env.MIP_RUM_APP_ID ?? "").trim();
  return {
    enabled: Boolean(endpoint && appId),
    endpoint,
    appId,
    apiKey: (env.MIP_RUM_API_KEY ?? "").trim() || null,
    env: (env.MIP_RUM_ENV ?? "prod").trim() || "prod",
    service: (env.MIP_RUM_SERVICE ?? "backend").trim() || "backend",
    flushMs: positiveNumber(env.MIP_RUM_FLUSH_MS, 3000, 300_000),
    maxQueue: positiveNumber(env.MIP_RUM_MAX_QUEUE, 1000, 100_000) || 1000,
    logs: (env.MIP_RUM_LOGS ?? "true") !== "false",
    logLevel: resolveLogLevel(env.MIP_RUM_LOG_LEVEL),
    logsEndpoint: logsEndpoint(endpoint, env.MIP_RUM_LOGS_ENDPOINT),
    // 2 s par défaut : très en deçà du sursis d'arrêt usuel (10 s chez Docker et
    // Kubernetes). Un agent de supervision ne doit jamais être la raison pour
    // laquelle un conteneur se fait tuer au lieu de s'arrêter proprement.
    shutdownTimeoutMs: positiveNumber(env.MIP_RUM_SHUTDOWN_MS, 2000, 30_000),
  };
}

const HEX32 = /^[0-9a-f]{32}$/i;
const HEX16 = /^[0-9a-f]{16}$/i;

/** Parse un en-tête W3C `traceparent` (00-<trace>-<span>-<flags>). null si invalide. */
export function parseTraceparent(h: string | null): { traceId: string; spanId: string } | null {
  if (!h) return null;
  const parts = h.trim().split("-");
  if (parts.length < 4) return null;
  const [, traceId, spanId] = parts;
  if (!HEX32.test(traceId) || !HEX16.test(spanId)) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId };
}

/** Extrait la session MIP d'un `tracestate` (`mip=s:<id>`). */
export function sessionFromTracestate(h: string | null): string | null {
  if (!h) return null;
  for (const part of h.split(",")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== "mip") continue;
    const v = part.slice(i + 1).trim();
    if (v.startsWith("s:")) return v.slice(2) || null;
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Templating de route : segments numériques / UUID / hex longs -> `:id` (borne la cardinalité). */
export function normalizeRoute(url: string): string {
  const path = url.split("?")[0].split("#")[0];
  const parts = path
    .split("/")
    .map((s) => (/^\d+$/.test(s) || UUID.test(s) || /^[0-9a-f]{16,}$/i.test(s) ? ":id" : s));
  return parts.join("/") || "/";
}

// --- encodage OTLP -----------------------------------------------------------
//
// P7.1 : la table de correspondance AnyValue et la conversion des horodatages
// viennent de `@mip/rum-core`, partagées avec les SDK web et React Native. Elles
// existaient ici en copie : un `intValue` encodé en nombre d'un côté et en
// chaîne de l'autre aurait produit deux vérités pour le même attribut, sans
// qu'aucun test ne le voie. Les NOMS exportés ne changent pas — `register.ts` et
// ses tests continuent d'appeler `encodeAttrs` et `nanos`.
import { encodeAttributes, msToNanos } from "@mip/rum-core";

type Attr = string | number | boolean | null | undefined;

export function encodeAttrs(o: Record<string, Attr>): Array<{ key: string; value: Record<string, unknown> }> {
  return encodeAttributes(o);
}

/** Epoch ms -> nanosecondes en chaîne (précision préservée, > 2^53). */
export function nanos(ms: number): string {
  return msToNanos(ms);
}

// --- exceptions (P5.3) ---------------------------------------------------------
// Contrat d'ingestion : un événement `exception` sur le span de la requête, ou un
// log portant les mêmes attributs `exception.*`. Les deux portent le même
// `mip.exception_id` quand ils décrivent la même Error : l'ingestion n'en écrit
// alors qu'une ligne.

/** Exception extraite d'une valeur levée ou journalisée. */
export interface ErrorDetails {
  type: string | null;
  message: string;
  stack: string | null;
}

// Plafonds d'ÉMISSION seulement : l'ingestion scrubbe puis tronque plus court.
// Larges à dessein, pour qu'une troncature ici ne coupe jamais un secret que le
// scrub serveur n'aurait plus reconnu.
const EXCEPTION_TYPE_MAX = 200;
const EXCEPTION_MESSAGE_MAX = 8_000;
const EXCEPTION_STACK_MAX = 16_000;

/** Lecture protégée : un accesseur hostile ne doit pas faire lever l'agent. */
function lire(fn: () => unknown): unknown {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Type, message et stack d'une Error, ou null pour toute autre valeur.
 *
 * CE QUI ÉTAIT FAUX. Le pont de logs testait `instanceof Error` puis ne gardait
 * que `name: message` : la stack — ce qui localise le bug — était jetée, et une
 * Error venue d'un autre realm (vm, worker) échouait au test et se sérialisait
 * en `{}`. `Object.prototype.toString` reconnaît une Error de tout realm ; une
 * valeur qui porte `message` et `stack` en chaînes est acceptée aussi.
 */
export function describeError(value: unknown): ErrorDetails | null {
  if (value === null || typeof value !== "object") return null;
  const tag = lire(() => Object.prototype.toString.call(value));
  const message = lire(() => (value as { message?: unknown }).message);
  const stack = lire(() => (value as { stack?: unknown }).stack);
  if (tag !== "[object Error]" && !(typeof message === "string" && typeof stack === "string")) return null;
  const name = lire(() => (value as { name?: unknown }).name);
  const constructeur = lire(() => (value as { constructor?: { name?: unknown } }).constructor?.name);
  const type = typeof name === "string" && name ? name : typeof constructeur === "string" && constructeur ? constructeur : null;
  return {
    type: type ? type.slice(0, EXCEPTION_TYPE_MAX) : null,
    message: typeof message === "string" ? message.slice(0, EXCEPTION_MESSAGE_MAX) : "",
    stack: typeof stack === "string" ? stack.slice(0, EXCEPTION_STACK_MAX) : null,
  };
}

/** Valeur LEVÉE (throw, rejet) : une Error, ou à défaut son texte, sans type ni stack inventés. */
export function describeThrown(value: unknown): ErrorDetails {
  const details = describeError(value);
  if (details) return details;
  const texte = lire(() => (typeof value === "string" ? value : JSON.stringify(value) ?? String(value)));
  return {
    type: null,
    message: (typeof texte === "string" ? texte : "valeur illisible").slice(0, EXCEPTION_MESSAGE_MAX),
    stack: null,
  };
}

export interface ExceptionInput {
  error: ErrorDetails;
  tsMs: number;
  /** `mip.exception_id` : identique pour une même Error, levée ou journalisée. */
  exceptionId: string;
  /** false : l'exception a échappé au code applicatif ; null : inconnu. */
  handled: boolean | null;
  /** true : le processus se termine ; null : inconnu. Jamais deviné. */
  fatal: boolean | null;
}

/** Attributs `exception.*` (conventions OpenTelemetry) et marqueurs MIP. */
export function exceptionAttributes(e: ExceptionInput): Record<string, Attr> {
  return {
    "exception.type": e.error.type,
    "exception.message": e.error.message,
    "exception.stacktrace": e.error.stack,
    "mip.exception_id": e.exceptionId,
    "mip.error_handled": e.handled,
    "mip.error_fatal": e.fatal,
  };
}

/** Événement OTLP `exception` d'un span. */
export function buildExceptionEvent(e: ExceptionInput): Record<string, unknown> {
  return { timeUnixNano: nanos(e.tsMs), name: "exception", attributes: encodeAttrs(exceptionAttributes(e)) };
}

export interface HttpSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  method: string;
  route: string;
  url: string | null;
  /** null : aucune réponse n'est partie, il n'existe pas de statut à rapporter. */
  status: number | null;
  sessionId: string | null;
  startMs: number;
  durationMs: number;
  /** Exceptions survenues pendant la requête, en événements du span. */
  exceptions?: ExceptionInput[];
  /** Identités métier BRUTES du scope de requête (HMAC au port serveur). */
  userId?: string | null;
  accountId?: string | null;
  /** Contexte métier du scope (`mip.context`) — snapshot des exceptions dérivées. */
  attributes?: Record<string, unknown>;
}

/** Span OTLP `http.server` (tier back côté ingestion). */
export function buildHttpServerSpan(i: HttpSpanInput): Record<string, unknown> {
  const exceptions = i.exceptions ?? [];
  // Une exception qui a ÉCHAPPÉ au code fait échouer l'opération, quel que soit
  // le statut déjà envoyé. Une exception capturée à la main puis traitée
  // (`handled: true`, P7.4) n'est pas un échec de requête : la réponse est
  // partie normalement, le span garde son statut — l'erreur est tout de même
  // remontée par son événement.
  const echouee = exceptions.find((e) => e.handled === false) ?? null;
  const status = echouee
    ? { code: 2 }
    : typeof i.status === "number" ? { code: i.status >= 500 ? 2 : 1 } : null;
  return {
    traceId: i.traceId,
    spanId: i.spanId,
    // `kind` et `parentSpanId` DANS LES CHAMPS NATIFS. Le span DB voisin les
    // portait déjà (buildDbSpan) ; celui-ci ne les avait qu'en attributs `mip.*`,
    // si bien que le maillon central du waterfall — la requête serveur — était
    // le seul qu'un collecteur OpenTelemetry tiers ne savait pas rattacher au
    // span navigateur qui l'a déclenché. L'attribut est conservé en repli.
    kind: 2, // SERVER
    ...(i.parentSpanId ? { parentSpanId: i.parentSpanId } : {}),
    ...(status ? { status } : {}),
    name: "http.server",
    startTimeUnixNano: nanos(i.startMs),
    endTimeUnixNano: nanos(i.startMs + i.durationMs),
    attributes: encodeAttrs({
      "mip.trace_id": i.traceId,
      "mip.span_id": i.spanId,
      "mip.parent_span_id": i.parentSpanId,
      "mip.route": i.route,
      "http.url": i.url,
      "http.method": i.method,
      "http.status_code": i.status,
      "http.duration_ms": i.durationMs,
      // Session, route, identités brutes et contexte métier du scope de requête.
      // Le port d'ingestion lit `mip.context` du span porteur comme snapshot des
      // exceptions qu'il transporte : le contexte d'un `withContext` arrive donc
      // sur l'erreur sans second canal.
      ...contextAttributes({ ...i, attributes: i.attributes }),
      // Indicateur d'échec standard (OpenTelemetry `error.type`, `_OTHER` sans type).
      "error.type": echouee ? (echouee.error.type ?? "_OTHER") : null,
    }),
    ...(exceptions.length ? { events: exceptions.map(buildExceptionEvent) } : {}),
  };
}

// --- profondeur DB (#20) : spans de requêtes base de données ------------------
// Enfants du span http.server courant : reconstituent le waterfall front ->
// serveur -> requête DB. Côté ingestion, ils tombent dans la branche « detail »
// (tier=detail, kind=db) — donc PAS de mip.session_id, kind non-serveur.

/** Normalise une requête SQL : littéraux (chaînes, nombres) -> `?`. Borne la
 *  cardinalité ET évite d'exfiltrer des valeurs (PII) dans db.statement. */
export function normalizeSql(sql: string): string {
  return String(sql ?? "")
    .replace(/'(?:[^']|'')*'/g, "?") // littéraux chaîne (quotes doublées incluses)
    .replace(/\b\d+\b/g, "?") // littéraux numériques
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** Verbe SQL en tête (SELECT/INSERT/…) -> db.operation. null si non reconnu. */
export function sqlOperation(sql: string): string | null {
  const m = /^\s*(select|insert|update|delete|with|create|drop|alter|truncate|begin|commit|rollback)\b/i.exec(
    String(sql ?? ""),
  );
  return m ? m[1].toUpperCase() : null;
}

export interface DbSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  system: string; // ex. "postgresql"
  statement: string; // déjà normalisé (sans littéraux)
  operation: string | null; // SELECT/INSERT/…
  startMs: number;
  durationMs: number;
}

/** Span OTLP d'une requête DB — enfant du span http.server (parentSpanId). */
export function buildDbSpan(i: DbSpanInput): Record<string, unknown> {
  const span: Record<string, unknown> = {
    traceId: i.traceId,
    spanId: i.spanId,
    kind: 3, // CLIENT — surtout PAS serveur (la branche « detail » exige !isServerKind)
    name: i.statement.slice(0, 120) || i.system,
    startTimeUnixNano: nanos(i.startMs),
    endTimeUnixNano: nanos(i.startMs + i.durationMs),
    attributes: encodeAttrs({
      "db.system": i.system,
      "db.statement": i.statement,
      "db.operation": i.operation,
    }),
  };
  if (i.parentSpanId) span.parentSpanId = i.parentSpanId;
  return span;
}

/** Enveloppe OTLP/HTTP JSON pour un lot de spans. */
export function buildPayload(cfg: AgentConfig, spans: Record<string, unknown>[]): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: encodeAttrs({
            "service.name": cfg.service,
            "mip.app_id": cfg.appId,
            "deployment.environment.name": cfg.env,
            "mip.api_key": cfg.apiKey,
          }),
        },
        scopeSpans: [{ scope: { name: "@mip/agent-node", version: "0.1.0" }, spans }],
      },
    ],
  };
}

// --- signal LOGS : pont de journalisation ------------------------------------
// Le 3e signal OTel n'était émis par AUCUN SDK : la table rum_log ne contenait
// que le dogfooding de la console, sans un seul trace_id. Le pont ci-dessous
// change cela — et le fait ici plutôt qu'ailleurs parce que l'agent tient déjà
// le contexte de requête (AsyncLocalStorage) : la corrélation log -> trace est
// donc gratuite, alors qu'elle coûterait cher dans n'importe quel autre SDK.

/** severityNumber OTLP par niveau (spec logs, stable depuis 1.0). */
export const SEVERITY: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

/** Ordre des niveaux, du plus verbeux au plus grave (filtre de plancher). */
export const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LEVELS)[number];

/**
 * Niveau plancher retenu : seuls les logs de gravité >= plancher sont émis.
 * Défaut `warn` — un agent de supervision ne doit pas doubler le volume de
 * journaux d'une application par défaut ; l'exploitant élargit s'il le veut.
 */
export function resolveLogLevel(raw: string | undefined): LogLevel {
  const v = String(raw ?? "").trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(v) ? (v as LogLevel) : "warn";
}

/** true si `level` doit être émis compte tenu du plancher configuré. */
export function passesLevel(level: LogLevel, floor: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[floor];
}

/** Endpoint LOGS dérivé de l'endpoint TRACES (même déploiement d'ingestion). */
export function logsEndpoint(tracesEndpoint: string, override?: string): string {
  const explicit = (override ?? "").trim();
  if (explicit) return explicit;
  return tracesEndpoint.replace(/v1-traces|\/v1\/traces/, (m) =>
    m === "v1-traces" ? "v1-logs" : "/v1/logs",
  );
}

export interface LogRecordInput {
  level: LogLevel;
  body: string;
  tsMs: number;
  /** Contexte de la requête courante — c'est lui qui rend le log corrélable. */
  traceId: string | null;
  spanId: string | null;
  sessionId: string | null;
  route: string | null;
  /** Exception structurée portée par ce log : son Error, jamais son texte. */
  exception?: ExceptionInput | null;
  /** Identités métier BRUTES du scope (HMAC au port serveur). */
  userId?: string | null;
  accountId?: string | null;
  /** Contexte métier du scope, porté en `mip.context` comme sur les spans. */
  attributes?: Record<string, unknown>;
}

/**
 * Enregistrement OTLP LOGS. traceId/spanId vont dans les champs NATIFS (que
 * l'ingestion lit en priorité) ; session et route passent par les attributs
 * mip.* comme pour les spans.
 */
export function buildLogRecord(i: LogRecordInput): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    timeUnixNano: nanos(i.tsMs),
    observedTimeUnixNano: nanos(i.tsMs),
    severityNumber: SEVERITY[i.level],
    severityText: i.level.toUpperCase(),
    body: { stringValue: i.body.slice(0, 4000) },
    attributes: encodeAttrs({
      "mip.source": "backend",
      ...contextAttributes(i),
      ...(i.exception ? exceptionAttributes(i.exception) : {}),
    }),
  };
  if (i.traceId) rec.traceId = i.traceId;
  if (i.spanId) rec.spanId = i.spanId;
  return rec;
}

// --- P7.4 : contexte de requête et événements métier (API publique) ----------
// Tout ce qui suit est PUR : la validation du contexte et la construction des
// spans `track.*` se testent sans processus, sans horloge réelle et sans réseau.
// Les limites reprennent celles du port d'ingestion (100 caractères pour un nom,
// 500 pour une valeur, 64 clés, profondeur 4). Le serveur reborne et scrubbe à
// réception : ce bornage-ci évite un aller-retour inutile, il ne le remplace pas.

const CONTEXT_MAX_NAME = 100;
const CONTEXT_MAX_STRING = 500;
const CONTEXT_MAX_KEYS = 64;
const CONTEXT_MAX_DEPTH = 4;
const IDENTITY_MAX = 500;

/** Nom d'événement ou de clé : non vide, sans caractère de contrôle, borné. */
export function boundedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > CONTEXT_MAX_NAME) return null;
  // eslint-disable-next-line no-control-regex
  return /[ -]/.test(clean) ? null : clean;
}

/**
 * Valeur de contexte conservée telle quelle : chaîne bornée, nombre fini,
 * booléen ou `null`. `undefined` signifie « rejetée ».
 *
 * `null` est une valeur, pas une absence : une propriété déclarée inconnue doit
 * le rester jusqu'en base plutôt que de devenir `0` ou `""`.
 */
function boundedValue(value: unknown, depth: number, budget: { keys: number }): unknown {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length <= CONTEXT_MAX_STRING ? value : value.slice(0, CONTEXT_MAX_STRING);
  if (typeof value !== "object") return undefined;
  if (depth >= CONTEXT_MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, CONTEXT_MAX_KEYS)) {
      const clean = boundedValue(item, depth + 1, budget);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (budget.keys >= CONTEXT_MAX_KEYS) break;
    const name = boundedName(key);
    if (!name) continue;
    const clean = boundedValue(item, depth + 1, budget);
    if (clean === undefined) continue;
    budget.keys++;
    out[name] = clean;
  }
  return out;
}

/**
 * Objet de contexte/props borné. Un cycle ou une valeur illisible n'est jamais
 * une exception dans l'application hôte : la clé fautive disparaît, le reste part.
 */
export function boundedObject(raw: unknown, maxBytes: number): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  let clean: unknown;
  try {
    clean = boundedValue(raw, 0, { keys: 0 });
  } catch {
    return {};
  }
  if (!clean || typeof clean !== "object" || Array.isArray(clean)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clean as Record<string, unknown>)) {
    out[key] = value;
    let taille: number;
    try {
      taille = JSON.stringify(out).length;
    } catch {
      delete out[key];
      continue;
    }
    if (taille > maxBytes) delete out[key];
  }
  return out;
}

/** Contexte accepté par `withContext` — tout est optionnel et validé. */
export interface RequestContextInput {
  /** En-tête W3C complet ; il prime sur `traceId`/`parentSpanId` séparés. */
  traceparent?: string;
  traceId?: string;
  parentSpanId?: string;
  /** Session RUM du navigateur, propagée par `tracestate: mip=s:<id>`. */
  sessionId?: string;
  route?: string;
  /** Identifiant métier BRUT : hashé en HMAC app-scopé au port serveur. */
  userId?: string;
  accountId?: string;
  /** Attributs métier libres du scope (`mip.context`). */
  attributes?: Record<string, unknown>;
}

/** Contexte validé : chaque champ est soit conforme, soit `null` (inconnu). */
export interface RequestContextPatch {
  traceId: string | null;
  parentSpanId: string | null;
  sessionId: string | null;
  route: string | null;
  userId: string | null;
  accountId: string | null;
  attributes: Record<string, unknown>;
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Valide un contexte de requête. Aucune valeur n'est devinée : un `traceparent`
 * malformé ne produit pas une trace inventée, il produit `null`. C'est ce qui
 * empêche un en-tête hostile de rattacher une requête à la trace d'un autre.
 */
export function validateRequestContext(input: RequestContextInput | null | undefined): RequestContextPatch {
  const source = input && typeof input === "object" ? input : {};
  const tp = typeof source.traceparent === "string" ? parseTraceparent(source.traceparent) : null;
  const traceId = tp?.traceId ?? (typeof source.traceId === "string" && HEX32.test(source.traceId) && !/^0+$/.test(source.traceId) ? source.traceId.toLowerCase() : null);
  const parentSpanId = tp?.spanId ?? (typeof source.parentSpanId === "string" && HEX16.test(source.parentSpanId) && !/^0+$/.test(source.parentSpanId) ? source.parentSpanId.toLowerCase() : null);
  const identite = (raw: unknown): string | null =>
    typeof raw === "string" && raw !== "" && raw.length <= IDENTITY_MAX && !/[ -]/.test(raw) ? raw : null;
  return {
    traceId,
    // Un parent sans trace n'a aucun sens : il rattacherait le span à un arbre
    // dont on ignore la racine.
    parentSpanId: traceId ? parentSpanId : null,
    sessionId: typeof source.sessionId === "string" && SESSION_ID.test(source.sessionId) ? source.sessionId : null,
    route: typeof source.route === "string" && source.route ? normalizeRoute(source.route).slice(0, 200) : null,
    userId: identite(source.userId),
    accountId: identite(source.accountId),
    attributes: boundedObject(source.attributes, 16 * 1024),
  };
}

/**
 * Clés refusées dans le contexte GLOBAL du processus.
 *
 * Le contexte global décrit le service, qui ne change pas d'une requête à
 * l'autre. Y poser un utilisateur ou un client, c'est l'attribuer à toutes les
 * requêtes suivantes, y compris celles d'autres personnes — la fuite exacte que
 * `withContext` existe pour éviter.
 */
export const GLOBAL_CONTEXT_REFUSE = new Set([
  "user", "account", "client", "session", "visitor", "customer",
  "tenant", "request", "trace", "span", "order", "email", "ip",
]);

/** Premier mot d'une clé, quelle que soit sa casse (`userId`, `user_id`, `USER-ID`). */
export function firstWord(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)[0]
    ?.toLowerCase() ?? "";
}

/** Attributs de service stables, ou `null` si l'un d'eux appartient à une requête. */
export function validateGlobalContext(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (GLOBAL_CONTEXT_REFUSE.has(firstWord(key))) return null;
  }
  return boundedObject(raw, 16 * 1024);
}

/** Attributs `mip.*` communs portés par un signal de requête. */
export function contextAttributes(ctx: {
  sessionId: string | null;
  route: string | null;
  userId?: string | null;
  accountId?: string | null;
  attributes?: Record<string, unknown>;
}): Record<string, Attr> {
  const contexte = ctx.attributes && Object.keys(ctx.attributes).length ? ctx.attributes : null;
  return {
    "mip.session_id": ctx.sessionId,
    "mip.route": ctx.route,
    // Identités BRUTES : le port d'ingestion les remplace par leur HMAC
    // app-scopé avant tout parseur. Aucun secret de hachage ne vit dans l'agent.
    "mip.identity.user_id": ctx.userId ?? null,
    "mip.identity.account_id": ctx.accountId ?? null,
    "mip.context": contexte ? JSON.stringify(contexte) : null,
  };
}

export interface TrackSpanInput {
  name: string;
  props: Record<string, unknown>;
  traceId: string;
  spanId: string;
  /** Span `http.server` de la requête courante, s'il y en a une. */
  parentSpanId: string | null;
  sessionId: string | null;
  route: string | null;
  userId?: string | null;
  accountId?: string | null;
  attributes?: Record<string, unknown>;
  tsMs: number;
}

/**
 * Span OTLP d'un événement métier — même enveloppe que `track()` du SDK web
 * (`track.<nom>`, `mip.event_type=custom`, `mip.event_name`, `mip.props`).
 *
 * Durée nulle : un événement est un instant, pas un intervalle. `kind` reste
 * absent, comme côté web ; c'est le nom qui route côté ingestion.
 */
export function buildTrackSpan(i: TrackSpanInput): Record<string, unknown> {
  const span: Record<string, unknown> = {
    traceId: i.traceId,
    spanId: i.spanId,
    name: `track.${i.name}`,
    startTimeUnixNano: nanos(i.tsMs),
    endTimeUnixNano: nanos(i.tsMs),
    attributes: encodeAttrs({
      "mip.event_type": "custom",
      "mip.event_name": i.name,
      "mip.props": JSON.stringify(i.props),
      ...contextAttributes(i),
    }),
  };
  if (i.parentSpanId) span.parentSpanId = i.parentSpanId;
  return span;
}

/** Enveloppe OTLP/HTTP JSON pour un lot de logs (miroir de buildPayload). */
export function buildLogPayload(
  cfg: AgentConfig,
  records: Record<string, unknown>[],
): unknown {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: encodeAttrs({
            "service.name": cfg.service,
            "mip.app_id": cfg.appId,
            "deployment.environment.name": cfg.env,
            "mip.api_key": cfg.apiKey,
            "mip.source": "backend",
          }),
        },
        scopeLogs: [{ scope: { name: "@mip/agent-node", version: "0.1.0" }, logRecords: records }],
      },
    ],
  };
}
