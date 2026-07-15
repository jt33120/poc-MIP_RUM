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
