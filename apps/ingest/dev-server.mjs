// Dev OTLP receiver — POST /v1/traces (OTLP/HTTP JSON) -> Postgres local.
// Équivalent local de l'edge function Deno (même parser _shared/otlp.mjs).
// v0.2 : nouvelles tables (resource/longtask/breadcrumb/event), inserts batch
// multi-lignes (une requête par table), vérif clé d'API (REQUIRE_API_KEY),
// rate limit 600 req/min par app_id.
import { createHash } from "node:crypto";
import http from "node:http";
import pg from "pg";
import { flattenOtlp } from "./supabase/functions/_shared/otlp.mjs";

const PORT = process.env.INGEST_PORT || 4318;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === "true";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 600);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
  "https://plateforme.groupement-it.com",
];

const recent = []; // ring buffer pour les assertions de test
const RING_SIZE = 50;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

// --- Registre d'apps : chargé au boot, rafraîchi toutes les 60 s -------------
let appRegistry = new Map(); // app_id -> { api_key_hash, active }

async function loadAppRegistry() {
  try {
    const { rows } = await pool.query(
      "select app_id, api_key_hash, active from app_registry",
    );
    appRegistry = new Map(rows.map((r) => [r.app_id, r]));
  } catch (err) {
    console.error("[ingest] app_registry load failed:", err.message);
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
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await batchInsert(
      client,
      "rum_session",
      ["session_id", "app_id", "client_id", "user_hash", "user_agent", "device_type", "started_at", "last_seen_at", "page_count"],
      sessions.map((s) => ({ ...s, started_at: s.last_seen_at, page_count: s.page_count_inc })),
      `on conflict (session_id) do update
         set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
             page_count   = rum_session.page_count + excluded.page_count,
             user_agent   = coalesce(rum_session.user_agent, excluded.user_agent)`,
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
  if (req.method === "GET" && req.url === "/__recent") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify(recent));
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/traces")) {
    res.writeHead(404, cors);
    return res.end();
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const payload = JSON.parse(body);
    recent.push(payload);
    if (recent.length > RING_SIZE) recent.shift();
    const rows = flattenOtlp(payload);

    // vérif clé d'API (403) — clé portée par l'attribut resource mip.api_key
    for (const { app_id, api_key } of rows.apiKeys) {
      const reason = checkApiKey(app_id, api_key);
      if (reason) {
        console.warn(`[ingest] 403 ${reason}`);
        res.writeHead(403, { "content-type": "application/json", ...cors });
        return res.end(JSON.stringify({ error: reason }));
      }
    }
    // rate limit (429) — une fois par app et par requête
    for (const appId of new Set(rows.apiKeys.map((k) => k.app_id))) {
      if (rateLimited(appId)) {
        console.warn(`[ingest] 429 rate limit exceeded for app: ${appId}`);
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60", ...cors });
        return res.end(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }));
      }
    }

    await writeRows(rows);
    console.log(
      `[ingest] ${new Date().toISOString()} ← ${origin || "(no origin)"} | sessions:${rows.sessions.length} pageviews:${rows.pageviews.length} metrics:${rows.metrics.length} errors:${rows.errors.length} resources:${rows.resources.length} longtasks:${rows.longtasks.length} breadcrumbs:${rows.breadcrumbs.length} events:${rows.events.length} rejected:${rows.rejected}`,
    );
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ partialSuccess: {} }));
  } catch (err) {
    console.error("[ingest] error:", err.message);
    res.writeHead(err instanceof SyntaxError ? 400 : 500, cors);
    res.end();
  }
});

await loadAppRegistry();
setInterval(loadAppRegistry, 60_000).unref();

server.listen(PORT, () =>
  console.log(
    `[ingest] OTLP dev receiver on http://localhost:${PORT}/v1/traces → ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")} | REQUIRE_API_KEY=${REQUIRE_API_KEY} rate=${RATE_LIMIT_PER_MIN}/min`,
  ),
);
