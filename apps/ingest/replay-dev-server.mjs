// Dev replay receiver — POST /v1/replay (corps binaire gzip rrweb) -> replay_chunk.
// Standalone sur :4319 (ne touche pas au receveur OTLP :4318). Équivalent local
// de l'edge function v1-replay (mêmes en-têtes x-mip-session/x-mip-app/x-mip-seq).
// Le corps est stocké COMPRESSÉ (bytea) ; gunzip de contrôle pour events_count.
import http from "node:http";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { corsHeaders as buildCors, REPLAY_ALLOW_HEADERS } from "./supabase/functions/_shared/cors.mjs";

const PORT = process.env.REPLAY_PORT || 4319;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const MAX_BODY_BYTES = 2 * 1024 * 1024; // garde-fou > cap SDK (1 Mo gzip/session)

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

// CORS partagé (règles _shared/cors.mjs, identiques à l'edge) + en-têtes replay x-mip-*
function corsHeaders(origin) {
  return buildCors(origin, [], { allowHeaders: REPLAY_ALLOW_HEADERS });
}

/** Header normalisé (node renvoie string | string[]). */
const header = (req, name) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req.headers.origin ?? "");

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/__health") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/replay")) {
    res.writeHead(404, cors);
    return res.end();
  }

  const sessionId = header(req, "x-mip-session");
  const appId = header(req, "x-mip-app");
  const seq = Number(header(req, "x-mip-seq"));
  if (!sessionId || !appId || !Number.isInteger(seq) || seq < 0) {
    res.writeHead(400, { "content-type": "application/json", ...cors });
    return res.end(
      JSON.stringify({ error: "missing x-mip-session/x-mip-app/x-mip-seq" }),
    );
  }

  const parts = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      res.writeHead(413, cors);
      return res.end();
    }
    parts.push(chunk);
  }
  const body = Buffer.concat(parts);

  let eventsCount;
  try {
    // gunzip de contrôle : compte les events, rejette les corps invalides (400)
    const events = JSON.parse(gunzipSync(body).toString("utf8"));
    eventsCount = Array.isArray(events) ? events.length : 0;
  } catch {
    res.writeHead(400, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ error: "body must be gzipped JSON" }));
  }

  try {
    // FK : le chunk peut précéder le 1er batch OTLP -> ligne session minimale
    await pool.query(
      `insert into rum_session (session_id, app_id) values ($1, $2)
       on conflict (session_id) do nothing`,
      [sessionId, appId],
    );
    await pool.query(
      `insert into replay_chunk (session_id, app_id, seq, events_count, body)
       values ($1, $2, $3, $4, $5)
       on conflict (session_id, seq) do nothing`,
      [sessionId, appId, seq, eventsCount, body], // body stocké compressé
    );
    console.log(
      `[replay] ${new Date().toISOString()} session=${sessionId.slice(0, 8)}… seq=${seq} events=${eventsCount} gzip=${body.length}o`,
    );
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true, seq, events: eventsCount }));
  } catch (err) {
    console.error("[replay] error:", err.message);
    res.writeHead(500, cors);
    res.end();
  }
});

server.listen(PORT, () =>
  console.log(
    `[replay] receiver on http://localhost:${PORT}/v1/replay → ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`,
  ),
);
