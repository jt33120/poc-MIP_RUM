// POST /api/ingest/v1/replay — chunk rrweb (corps binaire gzip) -> replay_chunk.
// Remplaçant de l'edge function Supabase `v1-replay`. Contrat inchangé côté SDK :
// métadonnées en en-têtes x-mip-session / x-mip-app / x-mip-seq (+ x-mip-key),
// corps stocké COMPRESSÉ, gunzip de contrôle pour compter les events.
//
// Parité d'auth avec la route traces (un endpoint durci et l'autre ouvert serait
// exactement le trou que shared/auth.mjs avait fermé) : app inconnue/inactive
// rejetée, clé exigée selon REQUIRE_API_KEY, rate limit par app.
import { gunzipSync } from "node:zlib";
import { writeReplayChunk } from "@mip/backend/lib/pg-ingest.mjs";
import { MAX_REPLAY_INFLATED_BYTES } from "@mip/backend/shared/limits.mjs";
import { REPLAY_ALLOW_HEADERS } from "@mip/backend/shared/cors.mjs";
import { withRetry } from "@mip/backend/shared/retry.mjs";
import { pool } from "@/lib/db";
import { corsFor, guardApps, json, log, refusIngestion } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// garde-fou > cap SDK (1 Mo gzip/session)
const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

const replayCors = (origin: string) =>
  corsFor(origin, { allowHeaders: REPLAY_ALLOW_HEADERS });

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: await replayCors(req.headers.get("origin") ?? ""),
  });
}

export async function POST(req: Request) {
  const cors = await replayCors(req.headers.get("origin") ?? "");

  const sessionId = req.headers.get("x-mip-session");
  const appId = req.headers.get("x-mip-app");
  const seq = Number(req.headers.get("x-mip-seq"));
  if (!sessionId || !appId || !Number.isInteger(seq) || seq < 0) {
    return json({ error: "missing x-mip-session/x-mip-app/x-mip-seq" }, 400, cors);
  }

  const blocked = await guardApps(
    [{ app_id: appId, api_key: req.headers.get("x-mip-key") }],
    cors,
  );
  if (blocked) return blocked;

  try {
    const body = Buffer.from(await req.arrayBuffer());
    if (!body.length || body.length > MAX_REPLAY_BYTES) {
      return json({ error: "invalid payload size" }, 413, cors);
    }

    // gunzip de contrôle : compte les events et rejette les corps invalides.
    // La borne de SORTIE est obligatoire : le plafond d'entrée (2 Mio) ne dit rien
    // de la taille décompressée, et l'inflation est synchrone. Au-delà, RangeError
    // → 400, comme un corps mal formé.
    let eventsCount: number;
    try {
      const events = JSON.parse(
        gunzipSync(body, { maxOutputLength: MAX_REPLAY_INFLATED_BYTES }).toString("utf8"),
      );
      eventsCount = Array.isArray(events) ? events.length : 0;
    } catch {
      return json({ error: "body must be gzipped JSON" }, 400, cors);
    }

    const issue = await withRetry(
      () => writeReplayChunk(pool, { sessionId, appId, seq, body, eventsCount }),
      {
        onRetry: (e: unknown, attempt: number) =>
          log.warn("db retry (replay)", { attempt, code: (e as { code?: string })?.code }),
      },
    );

    // P8.1 — deux refus, et dans les deux cas le corps n'est PAS persisté.
    // La session effacée reste refusée pour toujours ; la session pas encore
    // ancrée peut être rejouée après l'arrivée de son premier lot OTLP.
    if (issue?.etat === "refus_barriere") {
      log.warn("replay refused (erased session)", { app_id: appId, seq });
      return json({ error: "session erased" }, 410, cors);
    }
    if (issue?.etat === "attente_session") {
      log.info("replay deferred (session anchor missing)", { app_id: appId, seq });
      return json({ error: "session anchor not received yet", retry: true }, 425, cors, {
        "retry-after": String(issue.retryAfterS ?? 5),
      });
    }

    return json({ ok: true, seq, events: eventsCount }, 200, cors);
  } catch (err) {
    const refus = refusIngestion(err, cors);
    if (refus) return refus;
    log.error("internal error", { err: String(err) });
    return json({ error: "internal error" }, 500, cors);
  }
}
