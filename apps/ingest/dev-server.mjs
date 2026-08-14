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
import { flattenOtlp, flattenOtlpLogs } from "./supabase/functions/_shared/otlp.mjs";
import { createLogger } from "./supabase/functions/_shared/log.mjs";
import { withRetry } from "./supabase/functions/_shared/retry.mjs";
import { MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "./supabase/functions/_shared/limits.mjs";
import { corsHeaders as buildCors, originsFromRegistry } from "./supabase/functions/_shared/cors.mjs";
// Écriture partagée avec les routes Next.js de prod (lib/pg-ingest.mjs) : une
// seule implémentation des inserts, plus une copie par runtime.
import { writeRows, writeLogs } from "./lib/pg-ingest.mjs";

const log = createLogger("ingest");

const PORT = process.env.INGEST_PORT || 4318;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === "true";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 600);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

const recent = []; // ring buffer pour les assertions de test
const RING_SIZE = 50;

// En-têtes CORS (règles partagées _shared/cors.mjs, identiques à l'edge function)
function corsHeaders(origin) {
  return buildCors(origin, originsFromRegistry(appRegistry.values()));
}

// --- Registre d'apps : chargé au boot, rafraîchi toutes les 60 s -------------
let appRegistry = new Map(); // app_id -> { api_key_hash, active, allowed_origins }
let registryEverLoaded = false; // R4 : a-t-on déjà réussi un chargement ?

async function loadAppRegistry() {
  try {
    const { rows } = await pool.query(
      "select app_id, api_key_hash, active, allowed_origins from app_registry",
    );
    appRegistry = new Map(rows.map((r) => [r.app_id, r]));
    registryEverLoaded = true;
  } catch (err) {
    log.error("app_registry load failed", { err });
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** null si accepté, sinon raison du 403. api_key_hash null = legacy, pas de vérif. */
function checkApiKey(appId, apiKey) {
  if (!REQUIRE_API_KEY) return null;
  // R4 : registre jamais chargé (panne DB au boot) -> fail-open plutôt que de
  // rejeter tout le trafic en 403 (cohérent avec le fail-open du rate limit).
  if (!registryEverLoaded) {
    log.warn("api key check fail-open (registry never loaded)", { app_id: appId });
    return null;
  }
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

// --- Écriture -------------------------------------------------------------
// batchInsert / writeRows / writeLogs vivent dans ./lib/pg-ingest.mjs, partagés
// avec les routes Next.js de prod (apps/console/app/api/ingest/v1/*). Les deux
// chemins écrivent donc EXACTEMENT les mêmes lignes — c'est la raison d'être du
// module, au même titre que _shared/otlp.mjs pour le parsing.

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
  const isLogs = req.url.startsWith("/v1/logs");
  const isTraces = req.url.startsWith("/v1/traces");
  if (req.method !== "POST" || (!isTraces && !isLogs)) {
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

    // Signal LOGS (3e signal OTel) : resourceLogs -> rum_log. Mêmes gardes que
    // les traces (clé d'API 403, rate limit 429), écriture idempotente-libre.
    if (isLogs) {
      const parsed = flattenOtlpLogs(payload, { maxLogs: MAX_SPANS_PER_REQUEST });
      for (const { app_id, api_key } of parsed.apiKeys) {
        const reason = checkApiKey(app_id, api_key);
        if (reason) {
          log.warn("rejected: api key", { app_id, reason });
          res.writeHead(403, { "content-type": "application/json", ...cors });
          return res.end(JSON.stringify({ error: reason }));
        }
      }
      for (const appId of new Set(parsed.apiKeys.map((k) => k.app_id))) {
        if (await rateLimitedDurable(appId)) {
          log.warn("rate limited", { app_id: appId, limit: RATE_LIMIT_PER_MIN });
          res.writeHead(429, { "content-type": "application/json", "retry-after": "60", ...cors });
          return res.end(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }));
        }
      }
      await withRetry(() => writeLogs(pool, parsed.logs), {
        onRetry: (e, attempt) => log.warn("db retry (logs)", { attempt, code: e?.code }),
      });
      log.info("ingested logs", { logs: parsed.logs.length, rejected: parsed.rejected });
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify({ partialSuccess: {} }));
    }

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
    await withRetry(() => writeRows(pool, rows), {
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
