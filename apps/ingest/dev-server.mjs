// Dev OTLP receiver — POST /v1/traces (OTLP/HTTP JSON) -> Postgres local.
// Équivalent local de l'edge function Deno (même parser _shared/otlp.mjs).
// v0.2 : nouvelles tables (resource/longtask/breadcrumb/event), inserts batch
// multi-lignes (une requête par table), vérif clé d'API (REQUIRE_API_KEY),
// rate limit 600 req/min par app_id.
// v0.3 : geo_country (mip.tz -> pays, mapping _shared/tz-country.mjs) dans
// l'upsert session ; rate limit durable via rate_check() SQL (compteur mémoire
// conservé en pré-filtre rapide + fallback si SQL indisponible).
import { createHash } from "node:crypto";
import http from "node:http";
import pg from "pg";
import { flattenOtlp } from "./supabase/functions/_shared/otlp.mjs";
import { createLogger } from "./supabase/functions/_shared/log.mjs";
import { withRetry } from "./supabase/functions/_shared/retry.mjs";
import { MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "./supabase/functions/_shared/limits.mjs";

const log = createLogger("ingest");

const PORT = process.env.INGEST_PORT || 4318;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === "true";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 600);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

// Socle statique ; uni aux origines des clients en base (v0.5, cache 60 s du registre)
const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
  "https://plateforme.groupement-it.com",
];

const recent = []; // ring buffer pour les assertions de test
const RING_SIZE = 50;

function corsHeaders(origin) {
  const fromDb =
    origin &&
    [...appRegistry.values()].some((a) => a.active && a.allowed_origins?.includes(origin));
  const allowed = ALLOWED_ORIGINS.includes(origin) || fromDb ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

// --- Registre d'apps : chargé au boot, rafraîchi toutes les 60 s -------------
let appRegistry = new Map(); // app_id -> { api_key_hash, active, allowed_origins }

async function loadAppRegistry() {
  try {
    const { rows } = await pool.query(
      "select app_id, api_key_hash, active, allowed_origins from app_registry",
    );
    appRegistry = new Map(rows.map((r) => [r.app_id, r]));
  } catch (err) {
    log.error("app_registry load failed", { err });
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** null si accepté, sinon raison du 403. api_key_hash null = legacy, pas de vérif. */
function checkApiKey(appId, apiKey) {
  if (!REQUIRE_API_KEY) return null;
  const app = appRegistry.get(appId);
  if (!app || !app.active) return `unknown or inactive app: ${appId}`;
  if (app.api_key_hash == null) return null; // continuité G-IT : app sans clé
  if (!apiKey || sha256(apiKey) !== app.api_key_hash)
    return `invalid api key for app: ${appId}`;
  return null;
}

// --- Rate limit : fenêtre glissante 60 s par app_id (compteur mémoire) -------
const rateHits = new Map(); // app_id -> timestamps ms

function rateLimited(appId) {
  const now = Date.now();
  const hits = rateHits.get(appId) ?? [];
  while (hits.length && hits[0] <= now - 60_000) hits.shift();
  if (hits.length >= RATE_LIMIT_PER_MIN) return true;
  hits.push(now);
  rateHits.set(appId, hits);
  return false;
}

// v0.3 : compteur durable rate_check() (table rate_counter, partagé entre
// process). Pré-filtre mémoire d'abord (rapide, épargne le SQL en cas de
// flood), puis SQL ; si le SQL échoue -> fallback sur le verdict mémoire.
async function rateLimitedDurable(appId) {
  if (rateLimited(appId)) return true;
  try {
    const { rows } = await pool.query("select rate_check($1, $2) as ok", [
      appId,
      RATE_LIMIT_PER_MIN,
    ]);
    return rows[0].ok === false;
  } catch (err) {
    log.warn("rate_check sql failed (fallback mémoire)", { err });
    return false; // le compteur mémoire a déjà accepté
  }
}

// --- Écriture : un insert multi-lignes par table ------------------------------
function batchInsert(client, table, cols, rows, conflictClause) {
  if (!rows.length) return Promise.resolve();
  const params = [];
  const tuples = rows
    .map(
      (row) =>
        `(${cols
          .map((c) => {
            params.push(row[c]);
            return `$${params.length}`;
          })
          .join(",")})`,
    )
    .join(",");
  return client.query(
    `insert into ${table} (${cols.join(",")}) values ${tuples} ${conflictClause}`,
    params,
  );
}

async function writeRows({
  sessions,
  pageviews,
  metrics,
  errors,
  resources,
  longtasks,
  breadcrumbs,
  events,
  spans,
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await batchInsert(
      client,
      "rum_session",
      ["session_id", "app_id", "client_id", "user_hash", "user_agent", "device_type", "geo_country", "started_at", "last_seen_at", "page_count"],
      sessions.map((s) => ({ ...s, started_at: s.last_seen_at, page_count: s.page_count_inc })),
      `on conflict (session_id) do update
         set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
             page_count   = rum_session.page_count + excluded.page_count,
             user_agent   = coalesce(rum_session.user_agent, excluded.user_agent),
             geo_country  = coalesce(rum_session.geo_country, excluded.geo_country)`,
    );
    await batchInsert(
      client,
      "rum_pageview",
      ["span_id", "session_id", "app_id", "route", "url", "referrer", "nav_type", "started_at"],
      pageviews.map((p) => ({ ...p, started_at: p.ts })),
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_metric",
      ["span_id", "session_id", "app_id", "route", "name", "value", "rating", "attribution", "ts"],
      metrics.map((m) => ({ ...m, attribution: m.attribution ? JSON.stringify(m.attribution) : null })),
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_error",
      ["span_id", "session_id", "app_id", "route", "kind", "message", "error_type", "stack", "source", "lineno", "colno", "fingerprint", "ts"],
      errors,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_resource",
      ["span_id", "session_id", "app_id", "route", "url", "type", "duration_ms", "transfer_size", "render_blocking", "ts"],
      resources,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_longtask",
      ["span_id", "session_id", "app_id", "route", "duration_ms", "ts"],
      longtasks,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_breadcrumb",
      ["span_id", "session_id", "app_id", "type", "label", "seq", "ts"],
      breadcrumbs,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_event",
      ["span_id", "session_id", "app_id", "route", "name", "props", "ts"],
      events.map((e) => ({ ...e, props: e.props ? JSON.stringify(e.props) : null })),
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_span",
      ["span_id", "trace_id", "parent_span_id", "tier", "session_id", "app_id", "route", "url", "method", "status_code", "duration_ms", "ts"],
      spans ?? [],
      "on conflict (span_id) do nothing",
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  // liveness : le process répond (pas de dépendance externe)
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ status: "ok", service: "ingest" }));
  }
  // readiness : la base répond (sonde orchestrateur avant de router du trafic)
  if (req.method === "GET" && req.url === "/ready") {
    try {
      await pool.query("select 1");
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify({ status: "ready" }));
    } catch (err) {
      log.error("readiness check failed", { err });
      res.writeHead(503, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify({ status: "unready" }));
    }
  }
  if (req.method === "GET" && req.url === "/__recent") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify(recent));
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/traces")) {
    res.writeHead(404, cors);
    return res.end();
  }

  // garde-fou de charge : on coupe la connexion dès que le corps dépasse la
  // limite, sans accumuler tout le payload en mémoire (413)
  let body = "";
  let tooLarge = false;
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      tooLarge = true;
      break;
    }
  }
  if (tooLarge) {
    log.warn("payload too large", { bytes: body.length, max: MAX_BODY_BYTES });
    res.writeHead(413, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ error: "payload too large" }));
  }
  try {
    const payload = JSON.parse(body);
    recent.push(payload);
    if (recent.length > RING_SIZE) recent.shift();
    const rows = flattenOtlp(payload, { maxSpans: MAX_SPANS_PER_REQUEST });

    // vérif clé d'API (403) — clé portée par l'attribut resource mip.api_key
    for (const { app_id, api_key } of rows.apiKeys) {
      const reason = checkApiKey(app_id, api_key);
      if (reason) {
        log.warn("rejected: api key", { app_id, reason });
        res.writeHead(403, { "content-type": "application/json", ...cors });
        return res.end(JSON.stringify({ error: reason }));
      }
    }
    // rate limit (429) — une fois par app et par requête (durable : rate_check SQL)
    for (const appId of new Set(rows.apiKeys.map((k) => k.app_id))) {
      if (await rateLimitedDurable(appId)) {
        log.warn("rate limited", { app_id: appId, limit: RATE_LIMIT_PER_MIN });
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60", ...cors });
        return res.end(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }));
      }
    }

    // écriture rejouée sur erreur Postgres transitoire (la transaction entière
    // est idempotente : on conflict do nothing/greatest)
    await withRetry(() => writeRows(rows), {
      onRetry: (e, attempt) => log.warn("db retry", { attempt, code: e?.code }),
    });
    log.info("ingested", {
      origin: origin || null,
      sessions: rows.sessions.length,
      pageviews: rows.pageviews.length,
      metrics: rows.metrics.length,
      errors: rows.errors.length,
      resources: rows.resources.length,
      longtasks: rows.longtasks.length,
      breadcrumbs: rows.breadcrumbs.length,
      events: rows.events.length,
      spans: rows.spans.length,
      rejected: rows.rejected,
    });
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ partialSuccess: {} }));
  } catch (err) {
    // SyntaxError = JSON invalide (400, non rejouable) ; sinon incident (500)
    const status = err instanceof SyntaxError ? 400 : 500;
    log[status === 400 ? "warn" : "error"]("request failed", { status, err });
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: status === 400 ? "invalid json body" : "internal error" }));
  }
});

await loadAppRegistry();
const registryTimer = setInterval(loadAppRegistry, 60_000);
registryTimer.unref();

server.listen(PORT, () =>
  log.info("listening", {
    url: `http://localhost:${PORT}/v1/traces`,
    db: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
    require_api_key: REQUIRE_API_KEY,
    rate_per_min: RATE_LIMIT_PER_MIN,
  }),
);

// Arrêt propre : on cesse d'accepter, on draine les requêtes en vol, puis on
// ferme le pool — évite les connexions Postgres orphelines au redéploiement.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  clearInterval(registryTimer);
  server.close(async () => {
    try {
      await pool.end();
    } catch (err) {
      log.error("pool drain failed", { err });
    }
    process.exit(0);
  });
  // filet de sécurité : on n'attend pas indéfiniment les connexions persistantes
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
