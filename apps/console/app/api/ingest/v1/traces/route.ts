// POST /api/ingest/v1/traces — OTLP/HTTP JSON -> Postgres.
//
// Remplaçant de l'edge function Supabase `v1-traces` (disparue avec le projet).
// Même parser partagé (shared/otlp.mjs), mêmes gardes (413 taille, 403 clé,
// 429 débit, séparation stricte 400/500), même écriture idempotente — la
// logique vient du paquet `ingest`, pas d'une réécriture.
//
// Le chemin se termine par /v1/traces À DESSEIN : le SDK dérive l'endpoint
// replay en remplaçant "/v1/traces" par "/v1/replay" (packages/rum-sdk/src/
// replay.ts). Changer ce suffixe casserait le replay chez les clients qui ne
// surchargent pas `replayEndpoint`.
import { writeRows } from "@mip/backend/lib/pg-ingest.mjs";
import { secureOtlpIdentities } from "@mip/backend/lib/identity-hash.mjs";
import { flattenOtlp } from "@mip/backend/shared/otlp.mjs";
import { appliquerGeo } from "@mip/backend/shared/geoip.mjs";
import { bodyTooLarge, lireCorpsBorne, MAX_BODY_BYTES, MAX_SPANS_PER_REQUEST } from "@mip/backend/shared/limits.mjs";
import { withRetry } from "@mip/backend/shared/retry.mjs";
import { pool } from "@/lib/db";
import { corsFor, guardApps, json, log, refusIngestion } from "@/lib/ingest";
import { relayer } from "@/lib/ingest-relay";

// Beacons navigateur : jamais de cache, toujours du calcul serveur.
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
    // Lecture BORNÉE, puis JSON : `req.json()` lisait un corps sans longueur
    // annoncée jusqu'au plafond de la plateforme (4,5 Mo), là où le collector
    // refuse dès 2 Mo — même lot, 200 ici, 413 là-bas. Même lecture et même
    // décodage que le collector désormais (`lireCorpsBorne`, UTF-8 brut).
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
    const relayee = await relayer("traces", req, brut, cors);
    if (relayee) return relayee;
    let payload: unknown;
    try {
      payload = JSON.parse(brut.toString("utf8"));
    } catch {
      throw new BadRequestError("invalid json body");
    }
    const secured = secureOtlpIdentities(payload, process.env.IDENTITY_HASH_SECRET);
    const rows = flattenOtlp(secured.payload, { maxSpans: MAX_SPANS_PER_REQUEST });

    const blocked = await guardApps(rows.apiKeys, cors);
    if (blocked) return blocked;

    // géo sans stocker d'IP : priorité mip.tz (posé par flattenOtlp), repli
    // sur l'en-tête pays du CDN.
    //
    // PAS DE GEOIP LOCAL ICI, ET C'EST DÉLIBÉRÉ (P8.7). Ce filet vit dans une
    // fonction serverless : elle n'emporte pas la base DB-IP, et son processus
    // est recréé assez souvent pour qu'un chargement d'une seconde soit payé
    // bien plus qu'une fois. Le GeoIP est donc réservé au service d'ingestion
    // Railway, qui tourne en continu. La provenance `cdn` dit exactement ce qui
    // s'est passé : la résolution a eu lieu chez le CDN, pas chez nous.
    appliquerGeo(rows.sessions, {
      cdn: req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry"),
    });

    // La transaction entière est idempotente (on conflict do nothing /
    // greatest) : la rejouer sur erreur Postgres transitoire est sûr.
    const ecrit = await withRetry(() => writeRows(pool, rows), {
      onRetry: (e: unknown, attempt: number) =>
        log.warn("db retry", { attempt, code: (e as { code?: string })?.code }),
    });

    if (rows.rejected) log.info("partial accept", { rejected: rows.rejected });
    log.info("ingested", {
      sessions: rows.sessions.length,
      metrics: rows.metrics.length,
      errors: rows.errors.length,
      // Erreurs RÉELLEMENT insérées (RETURNING) : un rejeu n'en ajoute aucune.
      errors_inserted: ecrit.erreurs.inserees,
      spans: rows.spans.length,
      rejected: rows.rejected,
    });

    return json({ partialSuccess: {} }, 200, cors);
  } catch (err) {
    if (err instanceof BadRequestError) {
      log.warn("bad request", { reason: err.message });
      return json({ error: err.message }, 400, cors);
    }
    // P8.1 : portée d'application (409) et attente de verrou épuisée (503) sont
    // des refus identifiés, pas des incidents.
    const refus = refusIngestion(err, cors);
    if (refus) return refus;
    // 500 : incident serveur — le client PEUT rejouer (sa file de retry le fera).
    log.error("internal error", { err: String(err) });
    return json({ error: "internal error" }, 500, cors);
  }
}
