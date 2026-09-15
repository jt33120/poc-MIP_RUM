// POST /api/ingest/v1/logs — OTLP/HTTP JSON (signal LOGS) -> rum_log.
// Remplaçant de l'edge function Supabase `v1-logs`. Miroir de la route traces :
// mêmes gardes (413/403/429, 400 vs 500), parser partagé flattenOtlpLogs.
import { writeLogs } from "ingest/lib/pg-ingest.mjs";
import { flattenOtlpLogs } from "ingest/shared/otlp.mjs";
import { bodyTooLarge, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "ingest/shared/limits.mjs";
import { withRetry } from "ingest/shared/retry.mjs";
import { secureOtlpIdentities } from "ingest/lib/identity-hash.mjs";
import { pool } from "@/lib/db";
import { corsFor, guardApps, json, log } from "@/lib/ingest";

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
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      throw new BadRequestError("invalid json body");
    }
    payload = secureOtlpIdentities(payload, process.env.IDENTITY_HASH_SECRET).payload;
    const parsed = flattenOtlpLogs(payload, { maxLogs: MAX_SPANS_PER_REQUEST });

    const blocked = await guardApps(parsed.apiKeys, cors);
    if (blocked) return blocked;

    await withRetry(() => writeLogs(pool, parsed.logs), {
      onRetry: (e: unknown, attempt: number) =>
        log.warn("db retry (logs)", { attempt, code: (e as { code?: string })?.code }),
    });

    log.info("ingested logs", { logs: parsed.logs.length, rejected: parsed.rejected });
    return json({ partialSuccess: {} }, 200, cors);
  } catch (err) {
    if (err instanceof BadRequestError) {
      log.warn("bad request", { reason: err.message });
      return json({ error: err.message }, 400, cors);
    }
    log.error("internal error", { err: String(err) });
    return json({ error: "internal error" }, 500, cors);
  }
}
