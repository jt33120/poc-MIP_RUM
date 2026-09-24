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
import {
  lireCorpsBorne,
  lireSequenceReplay,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_INFLATED_BYTES,
} from "@mip/backend/shared/limits.mjs";
import { REPLAY_ALLOW_HEADERS } from "@mip/backend/shared/cors.mjs";
import { withRetry } from "@mip/backend/shared/retry.mjs";
import { pool } from "@/lib/db";
import { corsFor, guardApps, json, log, refusIngestion } from "@/lib/ingest";
import { choisirRelais } from "@/lib/ingest-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  // P3 — RELAIS vers le collector, pour la part tirée au sort, AVANT toute
  // garde locale : la clé, le débit et les en-têtes x-mip-* sont vérifiés par
  // le collector, et le chemin relayé ne touche pas la base de la console.
  // Le corps n'est lu (borné) QUE si la requête est relayée ; relu nulle part
  // ensuite : sur un repli, le chemin local reprend ces mêmes octets.
  // `undefined` = pas encore lu ; `null` = au-delà du plafond.
  let lu: Buffer | null | undefined;
  const relais = await choisirRelais("replay");
  if (relais) {
    try {
      lu = await lireCorpsBorne(req.body as unknown as AsyncIterable<Uint8Array> | null, MAX_REPLAY_BYTES);
    } catch (err) {
      // Flux interrompu : même issue qu'un `arrayBuffer()` qui échoue sur le
      // chemin local (500), sans relais d'un corps tronqué.
      log.error("internal error", { err: String(err) });
      return json({ error: "internal error" }, 500, cors);
    }
    // Vide ou trop gros : refus LOCAL, dans l'ordre du chemin local (400, 403,
    // 429 puis 413) — le relayer ne servirait qu'à faire répondre la même chose.
    if (lu !== null && lu.length) {
      const relayee = await relais.envoyer(req, lu, cors);
      if (relayee) return relayee;
    }
  }

  const sessionId = req.headers.get("x-mip-session");
  const appId = req.headers.get("x-mip-app");
  // Séquence ABSENTE = 400 : `Number(null)` valait 0, et le chunk écrasait la
  // place du vrai chunk 0 (même règle que le collector, `lireSequenceReplay`).
  const seq = lireSequenceReplay(req.headers.get("x-mip-seq"));
  if (!sessionId || !appId || seq === null) {
    return json({ error: "missing x-mip-session/x-mip-app/x-mip-seq" }, 400, cors);
  }

  const blocked = await guardApps(
    [{ app_id: appId, api_key: req.headers.get("x-mip-key") }],
    cors,
  );
  if (blocked) return blocked;

  try {
    // Lecture BORNÉE : `req.arrayBuffer()` matérialisait le corps entier AVANT
    // de mesurer (jusqu'au plafond de la plateforme, 4,5 Mo sur Vercel). On
    // s'arrête au premier octet au-delà de 2 Mio, comme le collector. Sur un
    // repli du relais, le corps est DÉJÀ lu (`lu`) : on reprend ces octets.
    const body =
      lu === undefined
        ? await lireCorpsBorne(req.body as unknown as AsyncIterable<Uint8Array> | null, MAX_REPLAY_BYTES)
        : lu;
    if (body === null || !body.length) {
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
