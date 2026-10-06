// POST /api/ingest/v1/traces — OTLP/HTTP (JSON ou protobuf), RELAYÉ au collector.
//
// Depuis C12 (06/10/2026), la console n'écrit plus rien : elle borne le corps,
// le transmet octet pour octet au collector (`lib/ingest-relay.ts`), qui décode,
// garde (clé, débit), hache l'identité et écrit. Collector injoignable : 503 +
// `retry-after`, et le SDK rejoue.
//
// Le chemin se termine par /v1/traces À DESSEIN : le SDK dérive l'endpoint
// replay en remplaçant "/v1/traces" par "/v1/replay" (packages/rum-sdk/src/
// replay.ts). Changer ce suffixe casserait le replay chez les clients qui ne
// surchargent pas `replayEndpoint`.
import { bodyTooLarge, lireCorpsBorne, MAX_BODY_BYTES } from "@mip/backend/shared/limits.mjs";
import { corsSansBase, formaterReponseOtlp, json, log, relayer } from "@/lib/ingest-relay";

// Beacons navigateur : jamais de cache, toujours du calcul serveur.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PLAFOND EXPLICITE de la fonction : 30 s. La chaîne des délais doit rester
// croissante — collector 4 s (budget dur, 503) < sonde /health (2 s) + relais
// 8 s (`DELAIS`) < fonction. Sans ce plafond, le défaut du projet tuerait la
// fonction AVANT le 503 du relais — un 504 FUNCTION_INVOCATION_TIMEOUT muet,
// sans « relay timeout » au journal. Voir docs/operations/relais-ingestion.md.
export const maxDuration = 30;

// Préflight et diagnostic : relayés aussi, le collector seul connaît les
// origines autorisées du registre.
export async function OPTIONS(req: Request) {
  return relayer("traces", req, new Uint8Array(), corsSansBase(req.headers.get("origin")));
}

export async function GET(req: Request) {
  return relayer("traces", req, new Uint8Array(), corsSansBase(req.headers.get("origin")));
}

// La réponse suit le format de la requête (JSON ou protobuf) : `formaterReponseOtlp`.
export async function POST(req: Request) {
  return formaterReponseOtlp(req, await traiter(req));
}

async function traiter(req: Request): Promise<Response> {
  const cors = corsSansBase(req.headers.get("origin"));

  // Refus de taille AVANT tout appel réseau : un corps qu'on refuserait de
  // toute façon ne part pas à Railway (et Vercel le borne à 4,5 Mo).
  if (bodyTooLarge(req.headers.get("content-length"))) {
    log.warn("payload too large", { content_length: req.headers.get("content-length"), max: MAX_BODY_BYTES });
    return json({ error: "payload too large" }, 413, cors);
  }
  let brut: Uint8Array | null;
  try {
    // Lecture BORNÉE, même plafond que le collector : un corps sans longueur
    // annoncée s'arrête au premier octet de trop.
    brut = await lireCorpsBorne(req.body as unknown as AsyncIterable<Uint8Array> | null, MAX_BODY_BYTES);
  } catch {
    // Flux interrompu par le client : rien à relayer d'un corps tronqué.
    return json({ error: "invalid json body" }, 400, cors);
  }
  if (brut === null) {
    log.warn("payload too large", { max: MAX_BODY_BYTES });
    return json({ error: "payload too large" }, 413, cors);
  }
  return relayer("traces", req, brut, cors);
}
