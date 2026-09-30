// POST /api/ingest/v1/logs — OTLP/HTTP JSON ou protobuf (signal LOGS) -> rum_log.
// Remplaçant de l'edge function Supabase `v1-logs`. Miroir de la route traces :
// mêmes gardes (413/403/415/429, 400 vs 500), parser partagé flattenOtlpLogs.
import { writeLogs } from "@mip/backend/lib/pg-ingest.mjs";
import { flattenOtlpLogs } from "@mip/backend/shared/otlp.mjs";
import { decoderCorpsOtlp, RefusCorpsOtlp } from "@mip/backend/shared/otlp-corps.mjs";
import { bodyTooLarge, lireCorpsBorne, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "@mip/backend/shared/limits.mjs";
import { withRetry } from "@mip/backend/shared/retry.mjs";
import { secureOtlpIdentities } from "@mip/backend/lib/identity-hash.mjs";
import { pool } from "@/lib/db";
import { corsFor, formaterReponseOtlp, guardApps, json, log, refusIngestion } from "@/lib/ingest";
import { relayer } from "@/lib/ingest-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PLAFOND EXPLICITE de la fonction : 30 s. La chaîne des délais doit rester
// croissante — collector 4 s (budget dur, 503) < relais 8 s (`DELAIS.relaisMs`)
// < fonction 30 s. Au pire, une requête enchaîne drapeau (1,5 s), sonde /health
// (2 s), relais (8 s) puis, sur un repli tardif, l'écriture locale (reprises,
// verrou) : ~27 s. Sans ce plafond, le défaut du projet (10 s en Hobby, 15 s
// en Pro hors Fluid) tuerait la fonction AVANT le 503 du relais — un 504
// FUNCTION_INVOCATION_TIMEOUT muet, sans « relay timeout » au journal.
// Voir docs/operations/relais-ingestion.md.
export const maxDuration = 30;

class BadRequestError extends Error {}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: await corsFor(req.headers.get("origin") ?? "") });
}

export async function GET(req: Request) {
  const cors = await corsFor(req.headers.get("origin") ?? "");
  return json({ status: "ok", service: "v1-logs" }, 200, cors);
}

// La réponse suit le format de la requête (JSON ou protobuf) : `formaterReponseOtlp`.
export async function POST(req: Request) {
  return formaterReponseOtlp(req, await traiter(req));
}

async function traiter(req: Request) {
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
    // P3 — RELAIS vers le collector, pour la part tirée au sort. Les MÊMES
    // octets servent au relais et, si le relais rend la main (`null` : relais
    // éteint, non tiré, ou repli), au chemin local ci-dessous : le corps n'est
    // lu qu'une fois. Les refus de taille restent locaux (aucune base, aucun
    // appel réseau pour un corps qu'on refuserait de toute façon).
    const relayee = await relayer("logs", req, brut, cors);
    if (relayee) return relayee;
    // JSON ou protobuf, gzip ou non : même décodeur que le collector et que la
    // route traces (`shared/otlp-corps.mjs`). Refus : 400, 413 ou 415.
    let payload: unknown;
    try {
      payload = decoderCorpsOtlp(brut, {
        signal: "logs",
        contentType: req.headers.get("content-type"),
        contentEncoding: req.headers.get("content-encoding"),
      }).payload;
    } catch (err) {
      if (!(err instanceof RefusCorpsOtlp)) throw err;
      log.warn("bad request", { reason: err.message, status: err.statut });
      return json({ error: err.message }, err.statut, cors);
    }
    payload =secureOtlpIdentities(payload, process.env.IDENTITY_HASH_SECRET).payload;
    const parsed = flattenOtlpLogs(payload, { maxLogs: MAX_SPANS_PER_REQUEST });

    const blocked = await guardApps(parsed.apiKeys, cors, req.headers.get("origin"));
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
