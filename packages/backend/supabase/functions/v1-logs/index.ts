// Edge function Supabase (Deno) — POST /v1/logs (OTLP/HTTP JSON, signal LOGS) -> Postgres.
// MIROIR de v1-traces pour le 3e signal OTel : même parser partagé (shared/otlp.mjs,
// flattenOtlpLogs), mêmes gardes (clé d'API 403, rate-limit durable 429, taille 413,
// séparation 400/500, retries écriture). Écrit dans rum_log (cf. migration-v29).
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flattenOtlpLogs } from "../../../shared/otlp.mjs";
import { createLogger } from "../../../shared/log.mjs";
import { withRetry } from "../../../shared/retry.mjs";
import { bodyTooLarge, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "../../../shared/limits.mjs";
import { corsHeaders as buildCors, originsFromRegistry } from "../../../shared/cors.mjs";

const log = createLogger("v1-logs");

/** Erreur de validation (4xx) : la requête est fautive, inutile de la rejouer. */
class BadRequestError extends Error {}

const REQUIRE_API_KEY = (Deno.env.get("REQUIRE_API_KEY") ?? "false") === "true";
const RATE_LIMIT_PER_MIN = Number(Deno.env.get("RATE_LIMIT_PER_MIN") ?? "600");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function corsHeaders(origin: string): Promise<Record<string, string>> {
  const extra = originsFromRegistry((await getAppRegistry()).values());
  return buildCors(origin, extra);
}

// --- Registre d'apps : cache 60 s (refresh paresseux, isolat éphémère) -------
let appRegistry = new Map<
  string,
  { api_key_hash: string | null; active: boolean; allowed_origins: string[] | null }
>();
let registryLoadedAt = 0;
let registryEverLoaded = false;

async function getAppRegistry() {
  if (Date.now() - registryLoadedAt < 60_000 && appRegistry.size) return appRegistry;
  const { data, error } = await supabase
    .from("app_registry")
    .select("app_id, api_key_hash, active, allowed_origins");
  if (!error && data) {
    appRegistry = new Map(data.map((r) => [r.app_id, r]));
    registryLoadedAt = Date.now();
    registryEverLoaded = true;
  } else if (error) {
    log.error("app_registry load failed", { err: error });
  }
  return appRegistry;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** null si accepté, sinon raison du 403. api_key_hash null = legacy, pas de vérif. */
async function checkApiKey(appId: string, apiKey: string | null): Promise<string | null> {
  if (!REQUIRE_API_KEY) return null;
  const registry = await getAppRegistry();
  if (!registryEverLoaded) {
    log.warn("api key check fail-open (registry never loaded)", { app_id: appId });
    return null;
  }
  const app = registry.get(appId);
  if (!app || !app.active) return `unknown or inactive app: ${appId}`;
  if (app.api_key_hash == null) return null;
  if (!apiKey || (await sha256(apiKey)) !== app.api_key_hash)
    return `invalid api key for app: ${appId}`;
  return null;
}

// --- Rate limit : fenêtre glissante 60 s par app_id (compteur mémoire) -------
const rateHits = new Map<string, number[]>();

function rateLimited(appId: string): boolean {
  const now = Date.now();
  const hits = rateHits.get(appId) ?? [];
  while (hits.length && hits[0] <= now - 60_000) hits.shift();
  if (hits.length >= RATE_LIMIT_PER_MIN) return true;
  hits.push(now);
  rateHits.set(appId, hits);
  return false;
}

async function rateLimitedDurable(appId: string): Promise<boolean> {
  if (rateLimited(appId)) return true;
  try {
    const { data, error } = await supabase.rpc("rate_check", {
      p_app_id: appId,
      p_limit: RATE_LIMIT_PER_MIN,
    });
    if (error) throw error;
    return data === false;
  } catch (err) {
    console.warn("[v1-logs] rate_check rpc failed (fallback mémoire):", err);
    return false;
  }
}

Deno.serve(async (req) => {
  const cors = await corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok", service: "v1-logs" }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  if (bodyTooLarge(req.headers.get("content-length"))) {
    log.warn("payload too large", { content_length: req.headers.get("content-length"), max: MAX_BODY_BYTES });
    return new Response(JSON.stringify({ error: "payload too large" }), {
      status: 413,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  try {
    // --- Phase 1 : parsing + validation (toute faute ici = 400, non rejouable) ---
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      throw new BadRequestError("invalid json body");
    }
    const { logs, apiKeys, rejected } = flattenOtlpLogs(payload, { maxLogs: MAX_SPANS_PER_REQUEST });

    // vérif clé d'API (403) — clé portée par l'attribut resource mip.api_key
    for (const { app_id, api_key } of apiKeys) {
      const reason = await checkApiKey(app_id, api_key);
      if (reason) {
        log.warn("rejected: api key", { app_id, reason });
        return new Response(JSON.stringify({ error: reason }), {
          status: 403,
          headers: { "content-type": "application/json", ...cors },
        });
      }
    }
    // rate limit (429) — une fois par app et par requête (durable : rate_check RPC)
    for (const appId of new Set(apiKeys.map((k) => k.app_id))) {
      if (await rateLimitedDurable(appId)) {
        log.warn("rate limited", { app_id: appId, limit: RATE_LIMIT_PER_MIN });
        return new Response(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60", ...cors },
        });
      }
    }

    // --- Phase 2 : écriture Postgres (incident ici = 500, le client peut rejouer) ---
    // rum_log est en bigserial (pas d'idempotence de clé) : insert simple. attributes
    // jsonb passé tel quel (supabase-js sérialise). Rejeu sur erreur transitoire.
    if (logs.length) {
      await withRetry(async () => {
        const { error } = await supabase.from("rum_log").insert(logs);
        if (error) throw error;
      }, {
        onRetry: (e: unknown, attempt: number) =>
          log.warn("db retry", { attempt, code: (e as { code?: string })?.code }),
      });
    }

    if (rejected) log.info("partial accept", { rejected });
    log.info("ingested logs", { logs: logs.length, rejected });

    return new Response(JSON.stringify({ partialSuccess: {} }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    if (err instanceof BadRequestError) {
      log.warn("bad request", { reason: err.message });
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "content-type": "application/json", ...cors },
      });
    }
    log.error("internal error", { err });
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
});
