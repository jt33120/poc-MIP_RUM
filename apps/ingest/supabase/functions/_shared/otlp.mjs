// Parser OTLP/HTTP JSON -> lignes SQL. JS pur, sans dépendance :
// importé tel quel par le dev-server Node (local) et l'edge function Deno (prod).

// Seuils 2026 (PLAN annexe B) — bornes [good, needs-improvement]
const THRESHOLDS = {
  LCP: [2000, 2500],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

/** Rating CWV selon seuils 2026 ; null si métrique inconnue. */
export function rating2026(name, value) {
  const t = THRESHOLDS[name];
  if (!t || typeof value !== "number") return null;
  return value <= t[0] ? "good" : value <= t[1] ? "needs-improvement" : "poor";
}

/** Déstructure un AnyValue OTLP ({stringValue|intValue|doubleValue|boolValue}). */
export function anyValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("intValue" in v) return Number(v.intValue); // arrive en string ou number selon l'émetteur
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(anyValue);
  return null;
}

/** KeyValue[] OTLP -> objet JS plat. */
export function attrsToObj(attrs) {
  const out = {};
  for (const kv of attrs ?? []) out[kv.key] = anyValue(kv.value);
  return out;
}

function nanosToDate(nanos) {
  if (!nanos) return new Date();
  return new Date(Number(BigInt(nanos) / 1000000n));
}

/** Tronque les stacks/messages, retire les query strings (PII, PLAN §14). */
function scrubUrl(url) {
  if (typeof url !== "string") return null;
  return url.split("?")[0].split("#")[0];
}

/**
 * Aplatit un payload OTLP/HTTP JSON en lignes SQL.
 * Rejette (compte) les resourceSpans sans mip.app_id (PLAN §7.2).
 * @returns {{sessions: object[], pageviews: object[], metrics: object[], errors: object[], rejected: number}}
 */
export function flattenOtlp(payload) {
  const sessions = new Map();
  const pageviews = [];
  const metrics = [];
  const errors = [];
  let rejected = 0;

  for (const rs of payload?.resourceSpans ?? []) {
    const res = attrsToObj(rs.resource?.attributes);
    const appId = res["mip.app_id"];
    if (!appId) {
      rejected++;
      continue;
    }
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const a = attrsToObj(span.attributes);
        const sessionId = a["mip.session_id"];
        if (!sessionId) {
          rejected++;
          continue;
        }
        const ts = nanosToDate(span.startTimeUnixNano);
        const route = a["mip.route"] ?? null;

        const s = sessions.get(sessionId) ?? {
          session_id: sessionId,
          app_id: appId,
          client_id: res["mip.client_id"] || null,
          user_hash: a["mip.user_hash"] ?? null,
          user_agent: res["mip.user_agent"] ?? null,
          device_type: a["mip.device_type"] ?? null,
          last_seen_at: ts,
          page_count_inc: 0,
        };
        if (ts > s.last_seen_at) s.last_seen_at = ts;
        sessions.set(sessionId, s);

        if (span.name.startsWith("webvital.")) {
          const name = a["webvital.name"] ?? span.name.slice("webvital.".length);
          const value = a["webvital.value"];
          if (typeof value !== "number") {
            rejected++;
            continue;
          }
          metrics.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name,
            value,
            rating: rating2026(name, value),
            attribution: a["webvital.attribution"] ?? null,
            ts,
          });
        } else if (span.name === "exception") {
          errors.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            kind: a["mip.error_kind"] ?? "error",
            message: String(a["exception.message"] ?? "").slice(0, 1000),
            error_type: a["exception.type"] ?? null,
            stack: String(a["exception.stacktrace"] ?? "").slice(0, 4000),
            source: scrubUrl(a["mip.error_source"]),
            lineno: a["mip.error_lineno"] ?? null,
            colno: a["mip.error_colno"] ?? null,
            ts,
          });
        } else if (span.name === "pageview") {
          s.page_count_inc++;
          pageviews.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route: route ?? "/",
            url: scrubUrl(a["mip.url"]),
            referrer: scrubUrl(a["mip.referrer"]),
            nav_type: a["mip.nav_type"] ?? null,
            ts,
          });
        }
        // autres spans (futures instrumentations) : ignorés silencieusement
      }
    }
  }
  return { sessions: [...sessions.values()], pageviews, metrics, errors, rejected };
}
