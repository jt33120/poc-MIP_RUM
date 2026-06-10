// Edge function Supabase (Deno) — POST /v1/replay (binaire gzip rrweb) -> replay_chunk.
// Même contrat que apps/ingest/replay-dev-server.mjs (en-têtes x-mip-*) :
// corps stocké COMPRESSÉ, gunzip de contrôle pour events_count.
// bytea via PostgREST : la colonne attend l'encodage hex '\x…'.
// @ts-nocheck deno runtime
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://plateforme.groupement-it.com",
  "http://localhost:8080",
  "http://localhost:3000",
];
const MAX_BODY_BYTES = 2 * 1024 * 1024; // garde-fou > cap SDK (1 Mo gzip/session)

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function corsHeaders(origin: string): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-mip-session,x-mip-app,x-mip-seq",
    "Access-Control-Max-Age": "86400",
  };
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin") ?? "");
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
