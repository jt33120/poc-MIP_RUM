// Edge function Supabase (Deno) — POST /v1/replay (binaire gzip rrweb) -> replay_chunk.
// Même contrat que services/collector/replay-dev-server.mjs (en-têtes x-mip-*) :
// corps stocké COMPRESSÉ, gunzip de contrôle pour events_count.
// bytea via PostgREST : la colonne attend l'encodage hex '\x…'.
//
// Sécurité (parité v1-traces) : cet endpoint appliquait AUCUNE auth — n'importe
// qui pouvait POSTer des chunks ET créer des sessions pour n'importe quel app_id.
// Il partage désormais l'auth de v1-traces (shared/auth.mjs) : app inconnue/inactive
// rejetée, clé exigée pour les apps qui en ont une (keyless toléré, continuité),
// rate limit par app. La clé arrive dans l'en-tête x-mip-key (replay = fetch, qui
// porte des en-têtes — contrairement au beacon OTLP qui passe par un attribut).
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as buildCors, REPLAY_ALLOW_HEADERS } from "../../../shared/cors.mjs";
import { createAuth } from "../../../shared/auth.mjs";
import { createLogger } from "../../../shared/log.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // garde-fou > cap SDK (1 Mo gzip/session)
const REQUIRE_API_KEY = (Deno.env.get("REQUIRE_API_KEY") ?? "false") === "true";
const RATE_LIMIT_PER_MIN = Number(Deno.env.get("RATE_LIMIT_PER_MIN") ?? "600");

const log = createLogger("v1-replay");
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const auth = createAuth(supabase, {
  requireApiKey: REQUIRE_API_KEY,
  rateLimitPerMin: RATE_LIMIT_PER_MIN,
  log,
});

// Origines CORS = origines des apps actives (registre partagé avec l'auth, un seul
// chargement/cache). x-mip-* ajoutés aux en-têtes autorisés (POST fetch du SDK).
async function corsHeaders(origin: string): Promise<Record<string, string>> {
  const registry = await auth.getAppRegistry();
  const origins: string[] = [];
  for (const app of registry.values()) {
    if (app?.active && Array.isArray(app.allowed_origins)) origins.push(...app.allowed_origins);
  }
  return buildCors(origin, origins, { allowHeaders: REPLAY_ALLOW_HEADERS });
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  const cors = await corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")
    return new Response("method not allowed", { status: 405, headers: cors });

  const sessionId = req.headers.get("x-mip-session");
  const appId = req.headers.get("x-mip-app");
  const seq = Number(req.headers.get("x-mip-seq"));
  if (!sessionId || !appId || !Number.isInteger(seq) || seq < 0)
    return new Response(
      JSON.stringify({ error: "missing x-mip-session/x-mip-app/x-mip-seq" }),
      { status: 400, headers: { "content-type": "application/json", ...cors } },
    );

  // auth (parité v1-traces) : app inconnue/inactive -> 403 ; clé exigée si l'app
  // en a une (keyless toléré) ; clé portée par x-mip-key (le SDK l'ajoute au POST).
  const reason = await auth.checkApiKey(appId, req.headers.get("x-mip-key"));
  if (reason) {
    log.warn("rejected: api key", { app_id: appId, reason });
    return new Response(JSON.stringify({ error: reason }), {
      status: 403,
      headers: { "content-type": "application/json", ...cors },
    });
  }
  if (await auth.rateLimitedDurable(appId)) {
    log.warn("rate limited", { app_id: appId, limit: RATE_LIMIT_PER_MIN });
    return new Response(JSON.stringify({ error: `rate limit exceeded for app: ${appId}` }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60", ...cors },
    });
  }

  try {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > MAX_BODY_BYTES)
      return new Response("invalid payload size", { status: 413, headers: cors });

    // gunzip de contrôle : compte les events, rejette les corps invalides
    let eventsCount: number;
    try {
      const events = JSON.parse(await gunzipText(body));
      eventsCount = Array.isArray(events) ? events.length : 0;
    } catch {
      return new Response(
        JSON.stringify({ error: "body must be gzipped JSON" }),
        { status: 400, headers: { "content-type": "application/json", ...cors } },
      );
    }

    // FK : le chunk peut précéder le 1er batch OTLP -> ligne session minimale
    {
      const { error } = await supabase
        .from("rum_session")
        .upsert(
          { session_id: sessionId, app_id: appId },
          { onConflict: "session_id", ignoreDuplicates: true },
        );
      if (error) throw error;
    }
    // body stocké COMPRESSÉ — encodage bytea PostgREST : '\x' + hex
    const { error } = await supabase.from("replay_chunk").upsert(
      {
        session_id: sessionId,
        app_id: appId,
        seq,
        events_count: eventsCount,
        body: "\\x" + toHex(body),
      },
      { onConflict: "session_id,seq", ignoreDuplicates: true },
    );
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, seq, events: eventsCount }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    console.error("[v1-replay]", err);
    return new Response("bad request", { status: 400, headers: cors });
  }
});
