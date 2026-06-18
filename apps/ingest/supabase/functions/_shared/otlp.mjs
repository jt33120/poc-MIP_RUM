// Parser OTLP/HTTP JSON -> lignes SQL. JS pur, sans dépendance :
// importé tel quel par le dev-server Node (local) et l'edge function Deno (prod).
// v0.3 : geo timezone->pays (attribut span mip.tz -> sessions[].geo_country).
import { tzToCountry } from "./tz-country.mjs";
// Scrub PII serveur (A2) : défense en profondeur, ne dépend pas du beforeSend client.
import { scrubProps, scrubText, scrubUrl } from "./scrub.mjs";

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
  if ("arrayValue" in v)
    return (Array.isArray(v.arrayValue?.values) ? v.arrayValue.values : []).map(anyValue);
  return null;
}

/** KeyValue[] OTLP -> objet JS plat. Tolère un payload malformé (A5 : durcissement). */
export function attrsToObj(attrs) {
  const out = {};
  for (const kv of Array.isArray(attrs) ? attrs : []) {
    if (kv && typeof kv.key === "string") out[kv.key] = anyValue(kv.value);
  }
  return out;
}

function nanosToDate(nanos) {
  if (!nanos) return new Date();
  try {
    return new Date(Number(BigInt(nanos) / 1000000n));
  } catch {
    return new Date(); // nanos non numérique (payload hostile) : ts = maintenant
  }
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

// --- v0.6 : auto-instrumentation OpenTelemetry standard (backend codeless) ------
// Un client qui lance son app sous un agent OTel (opentelemetry-instrument, agent
// Java/.NET/Node…) émet des spans SERVER au format semconv, PAS notre forme mip.*.
// On les accepte aussi -> span back, corrélés par trace_id comme notre middleware.

/** Span SERVER ? OTLP/JSON encode l'enum kind en entier (2) OU en chaîne. */
function isServerKind(kind) {
  return kind === 2 || kind === "SPAN_KIND_SERVER";
}

/** Durée ms entre deux timestamps OTLP (nanos string|number) ; null si absent/invalide. */
function durationMsBetween(startNanos, endNanos) {
  if (!startNanos || !endNanos) return null;
  try {
    return Number(BigInt(endNanos) - BigInt(startNanos)) / 1e6;
  } catch {
    return null;
  }
}

/** Session MIP éventuellement propagée dans le tracestate W3C : "mip=s:<sid>". */
function sessionFromTraceState(traceState) {
  if (typeof traceState !== "string" || !traceState) return null;
  for (const part of traceState.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== "mip") continue;
    const val = part.slice(eq + 1).trim();
    if (val.startsWith("s:")) return val.slice(2) || null;
  }
  return null;
}

/** Template de route homogène avec le front : {id} -> :id. */
function normalizeRouteTemplate(route) {
  return typeof route === "string" ? route.replace(/\{([^/}]+)\}/g, ":$1") : null;
}

/** Nom de span OTel ("GET /aos/{id}" ou "/aos/{id}") -> route, sinon null. */
function routeFromOtelName(name) {
  if (typeof name !== "string") return null;
  const stripped = name.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, "").trim();
  return stripped.startsWith("/") ? stripped : null;
}

/**
 * Aplatit un payload OTLP/HTTP JSON en lignes SQL.
 * Rejette (compte) les resourceSpans sans mip.app_id (PLAN §7.2).
 * v0.2 : resources/longtasks/breadcrumbs/events (track.*), fingerprint d'erreur,
 * apiKeys = clé `mip.api_key` lue sur la resource, un élément par resourceSpan accepté.
 * v0.4 : spans de tracing distribué — 'http.client' (SDK web, session requise)
 * et 'http.server' (middleware backend, session optionnelle via tracestate) ->
 * table rum_span, corrélés par mip.trace_id.
 * @param {object} payload  enveloppe OTLP/HTTP JSON.
 * @param {{maxSpans?: number}} [opts]  garde-fou anti-charge : au-delà de
 *        `maxSpans` spans dans une même requête, les suivants sont comptés
 *        `rejected` plutôt que traités (défaut 20 000).
 * @returns {{sessions: object[], pageviews: object[], metrics: object[], errors: object[],
 *            resources: object[], longtasks: object[], breadcrumbs: object[], events: object[],
 *            spans: object[], apiKeys: {app_id: string, api_key: string|null}[], rejected: number}}
 */
export function flattenOtlp(payload, opts = {}) {
  const maxSpans = opts.maxSpans ?? 20_000;
  let seen = 0; // total de spans rencontrés (cap anti-charge)
  const sessions = new Map();
  const pageviews = [];
  const metrics = [];
  const errors = [];
  const resources = [];
  const longtasks = [];
  const breadcrumbs = [];
  const events = [];
  const spans = [];
  const apiKeys = [];
  let rejected = 0;

  /** Ligne rum_span commune front/back ; null si trace_id/span_id absents. */
  const spanRow = (tier, a, appId, ts) => {
    const traceId = a["mip.trace_id"];
    const spanId = a["mip.span_id"];
    const durationMs = a["http.duration_ms"];
    if (!traceId || !spanId || typeof durationMs !== "number") return null;
    return {
      span_id: spanId,
      trace_id: traceId,
      parent_span_id: a["mip.parent_span_id"] ?? null,
      tier,
      session_id: a["mip.session_id"] ?? null,
      app_id: appId,
      route: a["mip.route"] ?? null,
      url: scrubUrl(a["http.url"]),
      method: a["http.method"] ?? null,
      status_code: a["http.status_code"] ?? null,
      duration_ms: durationMs,
      ts,
    };
  };

  for (const rs of Array.isArray(payload?.resourceSpans) ? payload.resourceSpans : []) {
    if (!rs || typeof rs !== "object") {
      rejected++;
      continue;
    }
    const res = attrsToObj(rs.resource?.attributes);
    const appId = res["mip.app_id"];
    if (!appId) {
      rejected++;
      continue;
    }
    apiKeys.push({ app_id: appId, api_key: res["mip.api_key"] ?? null });
    const release = res["mip.release"] ?? null; // version de l'app (dé-minification)
    for (const ss of Array.isArray(rs.scopeSpans) ? rs.scopeSpans : []) {
      for (const span of Array.isArray(ss?.spans) ? ss.spans : []) {
        // garde-fou : au-delà du plafond, on compte sans traiter (mémoire/CPU bornés)
        if (++seen > maxSpans) {
          rejected++;
          continue;
        }
        // durcissement A5 : un span sans nom (string) ne peut être routé -> rejet
        if (!span || typeof span.name !== "string") {
          rejected++;
          continue;
        }
        const a = attrsToObj(span.attributes);

        // span backend (middleware serveur) : pas de session requise, pas
        // d'upsert rum_session (le front est seul maître de la session)
        if (span.name === "http.server") {
          const row = spanRow("back", a, appId, nanosToDate(span.startTimeUnixNano));
          if (row) spans.push(row);
          else rejected++;
          continue;
        }

        // span SERVER d'auto-instrumentation OpenTelemetry standard (codeless,
        // toute stack via agent + Collector) : trace/span/parent au niveau du
        // span, attributs semconv http.*, session éventuelle via tracestate.
        // -> span back (1 par requête, comme notre middleware). Notre propre
        // http.server (ci-dessus) et http.client (kind interne) ne passent pas ici.
        const otelMethod = a["http.request.method"] ?? a["http.method"];
        if (
          isServerKind(span.kind) &&
          (otelMethod != null || a["http.route"] != null || a["url.path"] != null)
        ) {
          const durationMs = durationMsBetween(span.startTimeUnixNano, span.endTimeUnixNano);
          if (!span.traceId || !span.spanId || typeof durationMs !== "number") {
            rejected++;
            continue;
          }
          spans.push({
            span_id: span.spanId,
            trace_id: span.traceId,
            parent_span_id: span.parentSpanId || null,
            tier: "back",
            session_id: sessionFromTraceState(span.traceState) ?? a["mip.session_id"] ?? null,
            app_id: appId,
            route:
              normalizeRouteTemplate(a["http.route"]) ??
              normalizeRouteTemplate(routeFromOtelName(span.name)) ??
              (a["url.path"] ?? null),
            url: scrubUrl(a["url.full"] ?? a["http.url"]),
            method: otelMethod ?? null,
            status_code: a["http.response.status_code"] ?? a["http.status_code"] ?? null,
            duration_ms: durationMs,
            ts: nanosToDate(span.startTimeUnixNano),
          });
          continue;
        }

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
          // scrub PII AVANT troncature (un secret ne doit pas survivre coupé en deux)
          const message = (scrubText(a["exception.message"]) ?? "").slice(0, 1000);
          const stack = (scrubText(a["exception.stacktrace"]) ?? "").slice(0, 4000);
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
            release,
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
        } else if (span.name === "http.client") {
          const row = spanRow("front", a, appId, ts);
          if (row) spans.push(row);
          else rejected++;
        } else if (span.name.startsWith("track.")) {
          events.push({
            span_id: span.spanId,
            session_id: sessionId,
            app_id: appId,
            route,
            name: span.name.slice("track.".length),
            props: scrubProps(parseJsonAttr(a["mip.props"])),
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
    spans,
    apiKeys,
    rejected,
  };
}
