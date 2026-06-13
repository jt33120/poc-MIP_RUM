// Edge function Supabase (Deno) — POST /v1/traces (OTLP/HTTP JSON) -> Postgres.
// Même parser que le dev-server local (_shared/otlp.mjs ; copie déployée en sibling ./otlp.mjs).
// v0.2 : nouvelles tables (resource/longtask/breadcrumb/event), vérif clé d'API
// (REQUIRE_API_KEY via Deno.env, défaut false), rate limit 600 req/min par app_id
// (mémoire d'isolat : best effort, suffisant contre le flood accidentel).
// v0.3 : rate limit durable rate_check() partagé entre isolats (mémoire gardée
// en pré-filtre + fallback) ; geo_country priorité mip.tz (mapping tz->pays),
// fallback header CDN cf-ipcountry.
// v0.7 : robustesse prod — logs structurés (JSON lines), garde-fou de taille
// (413), séparation stricte 400 (requête invalide, ne pas rejouer) / 500
// (incident serveur, le client PEUT rejouer), retries à backoff sur les écritures
// Postgres transitoires (failover pooler, recyclage de connexion).
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flattenOtlp } from "../_shared/otlp.mjs";
import { createLogger } from "../_shared/log.mjs";
import { withRetry } from "../_shared/retry.mjs";
import { bodyTooLarge, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "../_shared/limits.mjs";

const log = createLogger("v1-traces");

/** Erreur de validation (4xx) : la requête est fautive, inutile de la rejouer. */
class BadRequestError extends Error {}

// Socle statique (toujours accepté) ; les origines des clients ajoutés via la
// console vivent en base (app_registry.allowed_origins, v0.5) et s'y unissent.
const ALLOWED_ORIGINS = [
  "https://plateforme.groupement-it.com",
  "http://localhost:8080",
  "http://localhost:3000",
];

const REQUIRE_API_KEY = (Deno.env.get("REQUIRE_API_KEY") ?? "false") === "true";
const RATE_LIMIT_PER_MIN = Number(Deno.env.get("RATE_LIMIT_PER_MIN") ?? "600");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function corsHeaders(origin: string): Promise<Record<string, string>> {
  let allowed = ALLOWED_ORIGINS.includes(origin) ? origin : null;
  if (!allowed && origin) {
    // origine d'un client enregistré en base (apps actives uniquement)
    for (const app of (await getAppRegistry()).values()) {
      if (app.active && app.allowed_origins?.includes(origin)) {
        allowed = origin;
        break;
      }
    }
  }
  return {
    "Access-Control-Allow-Origin": allowed ?? ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

// --- Registre d'apps : cache 60 s (refresh paresseux, isolat éphémère) -------
let appRegistry = new Map<
  string,
  { api_key_hash: string | null; active: boolean; allowed_origins: string[] | null }
>();
let registryLoadedAt = 0;

async function getAppRegistry() {
  if (Date.now() - registryLoadedAt < 60_000 && appRegistry.size) return appRegistry;
  const { data, error } = await supabase
    .from("app_registry")
    .select("app_id, api_key_hash, active, allowed_origins");
  if (!error && data) {
    appRegistry = new Map(data.map((r) => [r.app_id, r]));
    registryLoadedAt = Date.now();
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
  const app = (await getAppRegistry()).get(appId);
  if (!app || !app.active) return `unknown or inactive app: ${appId}`;
  if (app.api_key_hash == null) return null; // continuité G-IT : app sans clé
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

// v0.3 : compteur durable rate_check() (table rate_counter, partagé entre
// isolats). Pré-filtre mémoire d'abord (zéro round-trip en cas de flood local),
// puis RPC ; si l'RPC échoue -> fallback sur le verdict mémoire (best of both).
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
    console.warn("[v1-traces] rate_check rpc failed (fallback mémoire):", err);
    return false; // le compteur mémoire a déjà accepté
  }
}

Deno.serve(async (req) => {
  const cors = await corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok", service: "v1-traces" }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  // garde-fou de charge : on rejette tôt sur le Content-Length (413) avant de
  // matérialiser le corps en mémoire de l'isolat
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
    const rows = flattenOtlp(payload, { maxSpans: MAX_SPANS_PER_REQUEST });
    const { sessions, pageviews, metrics, errors, resources, longtasks, breadcrumbs, events, spans } = rows;

    // vérif clé d'API (403) — clé portée par l'attribut resource mip.api_key
    for (const { app_id, api_key } of rows.apiKeys) {
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
    for (const appId of new Set(rows.apiKeys.map((k) => k.app_id))) {
      if (await rateLimitedDurable(appId)) {
        log.warn("rate limited", { app_id: appId, limit: RATE_LIMIT_PER_MIN });
        return new Response(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60", ...cors },
        });
      }
    }

    // --- Phase 2 : écriture Postgres (incident ici = 500, le client peut rejouer) ---
    // géo sans stocker l'IP (PLAN §14) — priorité mip.tz (mapping tz->pays,
    // renseigné par flattenOtlp), fallback header CDN si présent
    const country = req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country");

    // chaque écriture est rejouée sur erreur Postgres transitoire (failover,
    // recyclage de connexion du pooler) ; une faute déterministe remonte direct
    const onRetry = (e: unknown, attempt: number) =>
      log.warn("db retry", { attempt, code: (e as { code?: string })?.code });

    for (const s of sessions) {
      await withRetry(async () => {
        const { error } = await supabase.rpc("upsert_rum_session", {
          p_session_id: s.session_id,
          p_app_id: s.app_id,
          p_client_id: s.client_id,
          p_user_hash: s.user_hash,
          p_user_agent: s.user_agent,
          p_device_type: s.device_type,
          p_geo_country: s.geo_country ?? country,
          p_last_seen_at: s.last_seen_at,
          p_page_count_inc: s.page_count_inc,
        });
        if (error) throw error;
      }, { onRetry });
    }
    const ins = async (table: string, batch: unknown[]) => {
      if (!batch.length) return;
      await withRetry(async () => {
        const { error } = await supabase.from(table).upsert(batch, {
          onConflict: "span_id",
          ignoreDuplicates: true,
        });
        if (error) throw error;
      }, { onRetry });
    };
    await ins("rum_pageview", pageviews.map(({ ts, ...p }) => ({ ...p, started_at: ts })));
    await ins("rum_metric", metrics);
    await ins("rum_error", errors);
    await ins("rum_resource", resources);
    await ins("rum_longtask", longtasks);
    await ins("rum_breadcrumb", breadcrumbs);
    await ins("rum_event", events);
    await ins("rum_span", spans); // v0.4 tracing distribué (front + back)

    // page_count DÉRIVÉ du compte réel de pageviews (idempotent au rejeu, cf.
    // migration-v07) — recalcul APRÈS l'insertion, pour les sessions qui ont
    // reçu ≥1 pageview dans ce lot (les autres ne changent pas de compte)
    for (const s of sessions) {
      if (!s.page_count_inc) continue;
      await withRetry(async () => {
        const { error } = await supabase.rpc("set_session_page_count", { p_session_id: s.session_id });
        if (error) throw error;
      }, { onRetry });
    }

    if (rows.rejected) log.info("partial accept", { rejected: rows.rejected });

    return new Response(JSON.stringify({ partialSuccess: {} }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    // 400 : requête fautive (le beacon ne doit pas réémettre une donnée invalide)
    if (err instanceof BadRequestError) {
      log.warn("bad request", { reason: err.message });
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "content-type": "application/json", ...cors },
      });
    }
    // 500 : incident serveur (DB indisponible…) — le client est invité à rejouer
    log.error("internal error", { err });
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
});
