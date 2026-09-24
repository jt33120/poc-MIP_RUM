// POST /api/ingest/v1/logs — OTLP/HTTP JSON (signal LOGS) -> rum_log.
// Remplaçant de l'edge function Supabase `v1-logs`. Miroir de la route traces :
// mêmes gardes (413/403/429, 400 vs 500), parser partagé flattenOtlpLogs.
import { writeLogs } from "@mip/backend/lib/pg-ingest.mjs";
import { flattenOtlpLogs } from "@mip/backend/shared/otlp.mjs";
import { bodyTooLarge, lireCorpsBorne, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "@mip/backend/shared/limits.mjs";
import { withRetry } from "@mip/backend/shared/retry.mjs";
import { secureOtlpIdentities } from "@mip/backend/lib/identity-hash.mjs";
import { pool } from "@/lib/db";
import { corsFor, guardApps, json, log, refusIngestion } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class BadRequestError extends Error {}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: await corsFor(req.headers.get("origin") ?? "") });
}

export async function GET(req: Request) {
  const cors = await corsFor(req.headers.get("origin") ?? "");
  return json({ status: "ok", service: "v1-logs" }, 200, cors);
}

export async function POST(req: Request) {
  const cors = await corsFor(req.headers.get("origin") ?? "");

  if (bodyTooLarge(req.headers.get("content-length"))) {
    log.warn("payload too large", {
      content_length: req.headers.get("content-length"),
      max: MAX_BODY_BYTES,
    });
    return json({ error: "payload too large" }, 413, cors);
  }

  try {
    // Lecture BORNÉE, comme la route traces et le collector : sans longueur
    // annoncée, `req.json()` ne bornait rien (contrat de parité, P2).
    const brut = await lireCorpsBorne(
      req.body as unknown as AsyncIterable<Uint8Array> | null,
      MAX_BODY_BYTES,
    ).catch(() => {
      throw new BadRequestError("invalid json body");
    });
    if (brut === null) {
      log.warn("payload too large", { max: MAX_BODY_BYTES });
      return json({ error: "payload too large" }, 413, cors);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(brut.toString("utf8"));
    } catch {
      throw new BadRequestError("invalid json body");
    }
    payload = secureOtlpIdentities(payload, process.env.IDENTITY_HASH_SECRET).payload;
    const parsed = flattenOtlpLogs(payload, { maxLogs: MAX_SPANS_PER_REQUEST });

    const blocked = await guardApps(parsed.apiKeys, cors);
    if (blocked) return blocked;

    // P5.3 : les exceptions structurées des logs partent dans la même transaction.
    const ecrit = await withRetry(() => writeLogs(pool, parsed.logs, parsed.errors), {
      onRetry: (e: unknown, attempt: number) =>
        log.warn("db retry (logs)", { attempt, code: (e as { code?: string })?.code }),
    });

    log.info("ingested logs", {
      logs: parsed.logs.length,
      // Exceptions RÉELLEMENT insérées (RETURNING), pas la taille du lot.
      exceptions: ecrit.erreurs.inserees,
      rejected: parsed.rejected,
    });
    return json({ partialSuccess: {} }, 200, cors);
  } catch (err) {
    if (err instanceof BadRequestError) {
      log.warn("bad request", { reason: err.message });
      return json({ error: err.message }, 400, cors);
    }
    // P8.1 : portée d'application (409) et attente de verrou épuisée (503).
    const refus = refusIngestion(err, cors);
    if (refus) return refus;
    log.error("internal error", { err: String(err) });
    return json({ error: "internal error" }, 500, cors);
  }
}
