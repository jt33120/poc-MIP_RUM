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

// --- encodage OTLP (aligné sur anyValue() de l'ingestion) --------------------

type Attr = string | number | null | undefined;
function anyValue(v: string | number): Record<string, unknown> {
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v };
}
export function encodeAttrs(o: Record<string, Attr>): Array<{ key: string; value: Record<string, unknown> }> {
  const out: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (const [key, v] of Object.entries(o)) {
    if (v == null) continue;
    out.push({ key, value: anyValue(v) });
  }
  return out;
}
/** Epoch ms -> nanosecondes en chaîne (précision préservée, > 2^53). */
export function nanos(ms: number): string {
  return `${Math.round(ms)}000000`;
}

export interface HttpSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  method: string;
  route: string;
  url: string | null;
  status: number;
  sessionId: string | null;
  startMs: number;
  durationMs: number;
}

/** Span OTLP `http.server` (tier back côté ingestion). */
export function buildHttpServerSpan(i: HttpSpanInput): Record<string, unknown> {
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
    ...(typeof i.status === "number" ? { status: { code: i.status >= 500 ? 2 : 1 } } : {}),
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
      "mip.session_id": i.sessionId,
    }),
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
      "mip.session_id": i.sessionId,
      "mip.route": i.route,
    }),
  };
  if (i.traceId) rec.traceId = i.traceId;
  if (i.spanId) rec.spanId = i.spanId;
  return rec;
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
