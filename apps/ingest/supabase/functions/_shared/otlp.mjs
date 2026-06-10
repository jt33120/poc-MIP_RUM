// Parser OTLP/HTTP JSON -> lignes SQL. JS pur, sans dépendance :
// importé tel quel par le dev-server Node (local) et l'edge function Deno (prod).
// v0.3 : geo timezone->pays (attribut span mip.tz -> sessions[].geo_country).
import { tzToCountry } from "./tz-country.mjs";

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

/** Attributs string JSON (webvital.attribution, mip.props) -> objet pour le jsonb. */
function parseJsonAttr(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Hash FNV-1a 32 bits -> hex sur 8 caractères. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const RE_URL = /https?:\/\/[^\s"')]+/gi;
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Message normalisé : urls, uuids puis chiffres remplacés par '#' (l'ordre compte). */
function normalizeMessage(message) {
  return String(message ?? "")
    .replace(RE_URL, "#")
    .replace(RE_UUID, "#")
    .replace(/\d+/g, "#")
    .trim();
}

/** Premier frame de la stack (ligne `at …` ou style `fn@url`), sans line:col. */
function firstStackFrame(stack) {
  const lines = String(stack ?? "").split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (/^at\s/.test(l) || /\S@\S/.test(l)) return l.replace(/:\d+:\d+/g, "");
  }
  return "";
}

/**
 * Fingerprint de regroupement d'erreurs (ROADMAP v0.2 §Contrat) :
 * fnv1a(error_type + message normalisé + 1er frame de stack sans line:col).
 * Stable pour une même famille (ids numériques / uuids / urls / line:col variables).
 */
export function errorFingerprint(errorType, message, stack) {
  return fnv1a(
    [errorType ?? "", normalizeMessage(message), firstStackFrame(stack)].join("|"),
  );
}

/**
 * Aplatit un payload OTLP/HTTP JSON en lignes SQL.
 * Rejette (compte) les resourceSpans sans mip.app_id (PLAN §7.2).
 * v0.2 : resources/longtasks/breadcrumbs/events (track.*), fingerprint d'erreur,
 * apiKeys = clé `mip.api_key` lue sur la resource, un élément par resourceSpan accepté.
 * @returns {{sessions: object[], pageviews: object[], metrics: object[], errors: object[],
 *            resources: object[], longtasks: object[], breadcrumbs: object[], events: object[],
 *            apiKeys: {app_id: string, api_key: string|null}[], rejected: number}}
 */
export function flattenOtlp(payload) {
  const sessions = new Map();
  const pageviews = [];
  const metrics = [];
  const errors = [];
  const resources = [];
  const longtasks = [];
  const breadcrumbs = [];
  const events = [];
  const apiKeys = [];
  let rejected = 0;

  for (const rs of payload?.resourceSpans ?? []) {
    const res = attrsToObj(rs.resource?.attributes);
    const appId = res["mip.app_id"];
    if (!appId) {
      rejected++;
      continue;
    }
    apiKeys.push({ app_id: appId, api_key: res["mip.api_key"] ?? null });
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
          geo_country: null,
          last_seen_at: ts,
          page_count_inc: 0,
        };
        if (ts > s.last_seen_at) s.last_seen_at = ts;
        // geo RGPD-friendly : timezone (attrs communs SDK v0.3) -> pays, null si inconnue
        if (s.geo_country == null && a["mip.tz"]) s.geo_country = tzToCountry(a["mip.tz"]);
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
            attribution: parseJsonAttr(a["webvital.attribution"]),
            ts,
          });
        } else if (span.name === "exception") {
          const errorType = a["exception.type"] ?? null;
          const message = String(a["exception.message"] ?? "").slice(0, 1000);
          const stack = String(a["exception.stacktrace"] ?? "").slice(0, 4000);
          errors.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            kind: a["mip.error_kind"] ?? "error",
            message,
            error_type: errorType,
            stack,
            source: scrubUrl(a["mip.error_source"]),
            lineno: a["mip.error_lineno"] ?? null,
            colno: a["mip.error_colno"] ?? null,
            fingerprint: errorFingerprint(errorType, message, stack),
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
        } else if (span.name === "resource") {
          resources.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            url: scrubUrl(a["resource.url"]),
            type: a["resource.type"] ?? null,
            duration_ms: a["resource.duration_ms"] ?? null,
            transfer_size: a["resource.transfer_size"] ?? null,
            render_blocking: a["resource.render_blocking"] ?? null,
            ts,
          });
        } else if (span.name === "longtask") {
          const durationMs = a["longtask.duration_ms"];
          if (typeof durationMs !== "number") {
            rejected++;
            continue;
          }
          longtasks.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            duration_ms: durationMs,
            ts,
          });
        } else if (span.name === "breadcrumb") {
          breadcrumbs.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            type: a["breadcrumb.type"] ?? "custom",
            label: a["breadcrumb.label"] ?? null,
            seq: a["breadcrumb.seq"] ?? null,
            ts,
          });
        } else if (span.name.startsWith("track.")) {
          events.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name: span.name.slice("track.".length),
            props: parseJsonAttr(a["mip.props"]),
            ts,
          });
        }
        // autres spans (futures instrumentations) : ignorés silencieusement
      }
    }
  }
  return {
    sessions: [...sessions.values()],
    pageviews,
    metrics,
    errors,
    resources,
    longtasks,
    breadcrumbs,
    events,
    apiKeys,
    rejected,
  };
}
