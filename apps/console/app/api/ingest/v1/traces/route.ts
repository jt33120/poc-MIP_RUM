// POST /api/ingest/v1/traces — OTLP/HTTP JSON -> Postgres.
//
// Remplaçant de l'edge function Supabase `v1-traces` (disparue avec le projet).
// Même parser partagé (_shared/otlp.mjs), mêmes gardes (413 taille, 403 clé,
// 429 débit, séparation stricte 400/500), même écriture idempotente — la
// logique vient du paquet `ingest`, pas d'une réécriture.
//
// Le chemin se termine par /v1/traces À DESSEIN : le SDK dérive l'endpoint
// replay en remplaçant "/v1/traces" par "/v1/replay" (packages/rum-sdk/src/
// replay.ts). Changer ce suffixe casserait le replay chez les clients qui ne
// surchargent pas `replayEndpoint`.
import { writeRows } from "ingest/lib/pg-ingest.mjs";
import { secureOtlpIdentities } from "ingest/lib/identity-hash.mjs";
import { flattenOtlp } from "ingest/shared/otlp.mjs";
import { bodyTooLarge, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "ingest/shared/limits.mjs";
import { withRetry } from "ingest/shared/retry.mjs";
import { pool } from "@/lib/db";
import { corsFor, guardApps, json, log } from "@/lib/ingest";

// Beacons navigateur : jamais de cache, toujours du calcul serveur.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Requête fautive (4xx) : la rejouer ne peut pas aider. */
class BadRequestError extends Error {}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: await corsFor(req.headers.get("origin") ?? "") });
}

export async function GET(req: Request) {
  const cors = await corsFor(req.headers.get("origin") ?? "");
  return json({ status: "ok", service: "v1-traces" }, 200, cors);
}

export async function POST(req: Request) {
  const cors = await corsFor(req.headers.get("origin") ?? "");

  // garde-fou de charge : rejet sur le Content-Length annoncé, avant de
  // matérialiser le corps en mémoire.
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
    const secured = secureOtlpIdentities(payload, process.env.IDENTITY_HASH_SECRET);
    const rows = flattenOtlp(secured.payload, { maxSpans: MAX_SPANS_PER_REQUEST });

    const blocked = await guardApps(rows.apiKeys, cors);
    if (blocked) return blocked;

    // géo sans stocker d'IP : priorité mip.tz (posé par flattenOtlp), repli
    // sur l'en-tête pays du CDN.
    const country =
      req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry");
    if (country) {
      for (const s of rows.sessions) s.geo_country = s.geo_country ?? country;
    }

    // La transaction entière est idempotente (on conflict do nothing /
    // greatest) : la rejouer sur erreur Postgres transitoire est sûr.
    await withRetry(() => writeRows(pool, rows), {
      onRetry: (e: unknown, attempt: number) =>
        log.warn("db retry", { attempt, code: (e as { code?: string })?.code }),
    });

    if (rows.rejected) log.info("partial accept", { rejected: rows.rejected });
    log.info("ingested", {
      sessions: rows.sessions.length,
      metrics: rows.metrics.length,
      errors: rows.errors.length,
      spans: rows.spans.length,
      rejected: rows.rejected,
    });

    return json({ partialSuccess: {} }, 200, cors);
  } catch (err) {
    if (err instanceof BadRequestError) {
      log.warn("bad request", { reason: err.message });
      return json({ error: err.message }, 400, cors);
    }
    // 500 : incident serveur — le client PEUT rejouer (sa file de retry le fera).
    log.error("internal error", { err: String(err) });
    return json({ error: "internal error" }, 500, cors);
  }
}
