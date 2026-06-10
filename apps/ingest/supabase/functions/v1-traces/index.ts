// Edge function Supabase (Deno) — POST /v1/traces (OTLP/HTTP JSON) -> Postgres.
// Même parser que le dev-server local (_shared/otlp.mjs). Déployée à S6 (cf. DEPLOY.md).
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flattenOtlp } from "../_shared/otlp.mjs";

const ALLOWED_ORIGINS = [
  "https://plateforme.groupement-it.com",
  "http://localhost:8080",
  "http://localhost:3000",
];

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

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  try {
    const payload = await req.json();
    const { sessions, pageviews, metrics, errors } = flattenOtlp(payload);

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

    return new Response(JSON.stringify({ partialSuccess: {} }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    console.error("[v1-traces]", err);
    return new Response("bad request", { status: 400, headers: cors });
  }
});
