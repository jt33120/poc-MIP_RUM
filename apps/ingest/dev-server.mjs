// Dev OTLP receiver — POST /v1/traces (OTLP/HTTP JSON).
// S1: logs payloads + ring buffer for test assertions. S2: writes to Postgres.
import http from "node:http";

const PORT = process.env.INGEST_PORT || 4318;

const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
  "https://plateforme.groupement-it.com",
];

const recent = []; // ring buffer of last received OTLP payloads
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

function spanNames(payload) {
  const names = [];
  for (const rs of payload.resourceSpans ?? [])
    for (const ss of rs.scopeSpans ?? [])
      for (const span of ss.spans ?? []) names.push(span.name);
  return names;
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
    console.log(
      `[ingest] ${new Date().toISOString()} POST /v1/traces ← ${origin || "(no origin)"} | spans: ${spanNames(payload).join(", ") || "(none)"}`,
    );
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ partialSuccess: {} }));
  } catch (err) {
    console.error("[ingest] bad payload:", err.message);
    res.writeHead(400, cors);
    res.end();
  }
});

server.listen(PORT, () =>
  console.log(`[ingest] OTLP dev receiver on http://localhost:${PORT}/v1/traces`),
);
