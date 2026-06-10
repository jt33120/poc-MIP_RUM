// Edge function Supabase (Deno) — POST /v1/traces (OTLP/HTTP JSON) -> Postgres.
// Même parser que le dev-server local (_shared/otlp.mjs ; copie déployée en sibling ./otlp.mjs).
// v0.2 : nouvelles tables (resource/longtask/breadcrumb/event), vérif clé d'API
// (REQUIRE_API_KEY via Deno.env, défaut false), rate limit 600 req/min par app_id
// (mémoire d'isolat : best effort, suffisant contre le flood accidentel).
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flattenOtlp } from "../_shared/otlp.mjs";

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

function corsHeaders(origin: string): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

// --- Registre d'apps : cache 60 s (refresh paresseux, isolat éphémère) -------
let appRegistry = new Map<string, { api_key_hash: string | null; active: boolean }>();
let registryLoadedAt = 0;

async function getAppRegistry() {
  if (Date.now() - registryLoadedAt < 60_000 && appRegistry.size) return appRegistry;
  const { data, error } = await supabase
    .from("app_registry")
    .select("app_id, api_key_hash, active");
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

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  try {
    const payload = await req.json();
    const rows = flattenOtlp(payload);
    const { sessions, pageviews, metrics, errors, resources, longtasks, breadcrumbs, events } = rows;

    // vérif clé d'API (403) — clé portée par l'attribut resource mip.api_key
    for (const { app_id, api_key } of rows.apiKeys) {
      const reason = await checkApiKey(app_id, api_key);
      if (reason) {
        console.warn(`[v1-traces] 403 ${reason}`);
        return new Response(JSON.stringify({ error: reason }), {
          status: 403,
          headers: { "content-type": "application/json", ...cors },
        });
      }
    }
    // rate limit (429) — une fois par app et par requête
    for (const appId of new Set(rows.apiKeys.map((k) => k.app_id))) {
      if (rateLimited(appId)) {
        console.warn(`[v1-traces] 429 rate limit exceeded for app: ${appId}`);
        return new Response(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60", ...cors },
        });
      }
    }

    // géo approximative sans stocker l'IP (PLAN §14) — header CDN si présent
    const country = req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country");

    for (const s of sessions) {
      const { error } = await supabase.rpc("upsert_rum_session", {
        p_session_id: s.session_id,
        p_app_id: s.app_id,
        p_client_id: s.client_id,
        p_user_hash: s.user_hash,
        p_user_agent: s.user_agent,
        p_device_type: s.device_type,
        p_geo_country: country,
        p_last_seen_at: s.last_seen_at,
        p_page_count_inc: s.page_count_inc,
      });
      if (error) throw error;
    }
    const ins = async (table: string, rows: unknown[]) => {
      if (!rows.length) return;
      const { error } = await supabase.from(table).upsert(rows, {
        onConflict: "span_id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    };
    await ins("rum_pageview", pageviews.map(({ ts, ...p }) => ({ ...p, started_at: ts })));
    await ins("rum_metric", metrics);
    await ins("rum_error", errors);
    await ins("rum_resource", resources);
    await ins("rum_longtask", longtasks);
    await ins("rum_breadcrumb", breadcrumbs);
    await ins("rum_event", events);

    return new Response(JSON.stringify({ partialSuccess: {} }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    console.error("[v1-traces]", err);
    return new Response("bad request", { status: 400, headers: cors });
  }
});
