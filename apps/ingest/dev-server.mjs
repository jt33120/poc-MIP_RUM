// Dev OTLP receiver — POST /v1/traces (OTLP/HTTP JSON) -> Postgres local.
// Équivalent local de l'edge function Deno (même parser _shared/otlp.mjs).
import http from "node:http";
import pg from "pg";
import { flattenOtlp } from "./supabase/functions/_shared/otlp.mjs";

const PORT = process.env.INGEST_PORT || 4318;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";

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

async function writeRows({ sessions, pageviews, metrics, errors }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const s of sessions) {
      await client.query(
        `insert into rum_session (session_id, app_id, client_id, user_hash, user_agent, device_type, started_at, last_seen_at, page_count)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8)
         on conflict (session_id) do update
           set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
               page_count   = rum_session.page_count + excluded.page_count,
               user_agent   = coalesce(rum_session.user_agent, excluded.user_agent)`,
        [s.session_id, s.app_id, s.client_id, s.user_hash, s.user_agent, s.device_type, s.last_seen_at, s.page_count_inc],
      );
    }
    for (const p of pageviews) {
      await client.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, nav_type, started_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (span_id) do nothing`,
        [p.span_id, p.session_id, p.app_id, p.route, p.url, p.referrer, p.nav_type, p.ts],
      );
    }
    for (const m of metrics) {
      await client.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, attribution, ts)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (span_id) do nothing`,
        [m.span_id, m.session_id, m.app_id, m.route, m.name, m.value, m.rating, m.attribution ? JSON.stringify(m.attribution) : null, m.ts],
      );
    }
    for (const e of errors) {
      await client.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, stack, source, lineno, colno, ts)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (span_id) do nothing`,
        [e.span_id, e.session_id, e.app_id, e.route, e.kind, e.message, e.error_type, e.stack, e.source, e.lineno, e.colno, e.ts],
      );
    }
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
    await writeRows(rows);
    console.log(
      `[ingest] ${new Date().toISOString()} ← ${origin || "(no origin)"} | sessions:${rows.sessions.length} pageviews:${rows.pageviews.length} metrics:${rows.metrics.length} errors:${rows.errors.length} rejected:${rows.rejected}`,
    );
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ partialSuccess: {} }));
  } catch (err) {
    console.error("[ingest] error:", err.message);
    res.writeHead(err instanceof SyntaxError ? 400 : 500, cors);
    res.end();
  }
});

server.listen(PORT, () =>
  console.log(`[ingest] OTLP dev receiver on http://localhost:${PORT}/v1/traces → ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`),
);
