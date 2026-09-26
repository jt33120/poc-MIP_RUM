/**
 * MIP RUM — middleware Express/Connect de tracing distribué (un fichier, zéro dépendance).
 *
 * Lit le header W3C `traceparent` injecté par le SDK web MIP RUM, chronomètre la
 * requête, et expédie un span OTLP/HTTP JSON `http.server` vers l'ingestion MIP.
 * Corrélation front→back par trace_id ; la session web (optionnelle) voyage dans
 * `tracestate: mip=s:<session_id>`.
 *
 * Activation par variables d'environnement — sans elles, passthrough total :
 *   MIP_RUM_ENDPOINT  ex. https://mip-rum-console.vercel.app/api/ingest/v1/traces
 *   MIP_RUM_APP_ID    ex. mon-app
 *   MIP_RUM_API_KEY   optionnel (clé d'app MIP RUM)
 *   MIP_RUM_IGNORE    routes exactes ignorées (défaut "/health,/favicon.ico")
 *
 * Usage (Node >= 18, fetch natif) :
 *   const mipRum = require("./mip-rum-express");      // ou import mipRum from …
 *   app.use(mipRum());                                 // env vars
 *   app.use(mipRum({ endpoint, appId, apiKey }));      // ou config explicite
 *
 * Garanties : aucune exception ne remonte à l'app hôte ; ni corps, ni query
 * string, ni header métier collectés (route template + méthode + statut + durée) ;
 * batch mémoire borné (flush 5 s ou 20 spans, file coupée à 1000) ; envoi best
 * effort (timeout 3 s, échec silencieux).
 */
"use strict";

const VERSION = "0.5.0";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const TRACESTATE_MIP = /(?:^|[,\s])mip=s:([A-Za-z0-9_-]{1,64})/;
const SEG_NUM = /^\d+$/;
const SEG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEG_HEX = /^[0-9a-f]{16,}$/i;
const DEFAULT_IGNORE = "/health,/favicon.ico";

/** Même convention que le SDK web : /partners/42 -> /partners/:id. */
function normalize(path) {
  return (
    path
      .split("/")
      .map((s) => (SEG_NUM.test(s) || SEG_UUID.test(s) || SEG_HEX.test(s) ? ":id" : s))
      .join("/") || "/"
  );
}

function kv(key, value) {
  let v;
  if (typeof value === "boolean") v = { boolValue: value };
  else if (Number.isInteger(value)) v = { intValue: String(value) };
  else if (typeof value === "number") v = { doubleValue: value };
  else v = { stringValue: String(value) };
  return { key, value: v };
}

function hex(n) {
  const bytes = new Uint8Array(n);
  (globalThis.crypto ?? require("node:crypto").webcrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

module.exports = function mipRum(opts = {}) {
  const endpoint = opts.endpoint ?? process.env.MIP_RUM_ENDPOINT;
  const appId = opts.appId ?? process.env.MIP_RUM_APP_ID;
  const apiKey = opts.apiKey ?? process.env.MIP_RUM_API_KEY;
  const serviceName = opts.serviceName ?? "express";
  const flushMs = opts.flushMs ?? 5000;
  const batchSize = opts.batchSize ?? 20;
  const queueMax = opts.queueMax ?? 1000;
  const ignore = new Set(
    (opts.ignore ?? process.env.MIP_RUM_IGNORE ?? DEFAULT_IGNORE)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // inactif sans config : middleware no-op, zéro coût
  if (!endpoint || !appId) return (req, res, next) => next();

  let buf = [];
  let timer = null;

  function otlp(batch) {
    const resAttrs = [kv("service.name", serviceName), kv("mip.app_id", appId)];
    if (apiKey) resAttrs.push(kv("mip.api_key", apiKey));
    return {
      resourceSpans: [
        {
          resource: { attributes: resAttrs },
          scopeSpans: [{ scope: { name: "mip-rum-express", version: VERSION }, spans: batch }],
        },
      ],
    };
  }

  function flush() {
    if (!buf.length) return;
    const batch = buf.slice(0, 200);
    buf = buf.slice(200);
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 3000);
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(otlp(batch)),
        signal: ctl.signal,
      })
        .catch(() => {}) // best effort
        .finally(() => clearTimeout(to));
    } catch {
      /* le tracing ne casse JAMAIS l'app hôte */
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
    if (typeof timer.unref === "function") timer.unref(); // ne retient pas le process
  }

  return function mipRumMiddleware(req, res, next) {
    if (req.method === "OPTIONS" || ignore.has(req.path ?? req.url)) return next();

    const startNs = BigInt(Date.now()) * 1_000_000n;
    const t0 = process.hrtime.bigint();

    res.on("finish", () => {
      try {
        const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
        const m = TRACEPARENT.exec(req.headers["traceparent"] ?? "");
        const traceId = m ? m[1] : hex(16);
        const parentSpanId = m ? m[2] : null;
        const spanId = hex(8);
        const ms = TRACESTATE_MIP.exec(req.headers["tracestate"] ?? "");
        const sessionId = ms ? ms[1] : null;

        // route template Express si posée par le routing, sinon path normalisé
        const path = (req.originalUrl ?? req.url ?? "/").split("?")[0];
        const routePath =
          req.route?.path && typeof req.route.path === "string"
            ? (req.baseUrl ?? "") + req.route.path
            : normalize(path);

        const attrs = [
          kv("mip.trace_id", traceId),
          kv("mip.span_id", spanId),
          kv("mip.route", routePath),
          kv("http.url", path),
          kv("http.method", (req.method ?? "GET").toUpperCase()),
          kv("http.status_code", res.statusCode | 0),
          kv("http.duration_ms", Math.round(durationMs * 10) / 10),
        ];
        if (parentSpanId) attrs.push(kv("mip.parent_span_id", parentSpanId));
        if (sessionId) attrs.push(kv("mip.session_id", sessionId));

        const span = {
          traceId,
          spanId,
          name: "http.server",
          kind: 2,
          startTimeUnixNano: String(startNs),
          endTimeUnixNano: String(startNs + BigInt(Math.round(durationMs * 1e6))),
          attributes: attrs,
        };
        if (parentSpanId) span.parentSpanId = parentSpanId;

        if (buf.length >= queueMax) buf.splice(0, buf.length - queueMax + 1);
        buf.push(span);
        if (buf.length >= batchSize) flush();
        else schedule();
      } catch {
        /* jamais d'impact sur la requête hôte */
      }
    });

    next();
  };
};
