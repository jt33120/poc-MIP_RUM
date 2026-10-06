// POST /api/ingest/v1/logs — OTLP/HTTP JSON ou protobuf (signal LOGS), RELAYÉ au
// collector. Miroir de la route traces : depuis C12 (06/10/2026), la console
// borne le corps et le transmet ; le collector décode, garde et écrit.
import { bodyTooLarge, lireCorpsBorne, MAX_BODY_BYTES } from "@mip/backend/shared/limits.mjs";
import { corsSansBase, formaterReponseOtlp, json, log, relayer } from "@/lib/ingest-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PLAFOND EXPLICITE de la fonction : 30 s (voir la route traces).
export const maxDuration = 30;

export async function OPTIONS(req: Request) {
  return relayer("logs", req, new Uint8Array(), corsSansBase(req.headers.get("origin")));
}

export async function GET(req: Request) {
  return relayer("logs", req, new Uint8Array(), corsSansBase(req.headers.get("origin")));
}

// La réponse suit le format de la requête (JSON ou protobuf) : `formaterReponseOtlp`.
export async function POST(req: Request) {
  return formaterReponseOtlp(req, await traiter(req));
}

async function traiter(req: Request): Promise<Response> {
  const cors = corsSansBase(req.headers.get("origin"));

  if (bodyTooLarge(req.headers.get("content-length"))) {
    log.warn("payload too large", { content_length: req.headers.get("content-length"), max: MAX_BODY_BYTES });
    return json({ error: "payload too large" }, 413, cors);
  }
  let brut: Uint8Array | null;
  try {
    brut = await lireCorpsBorne(req.body as unknown as AsyncIterable<Uint8Array> | null, MAX_BODY_BYTES);
  } catch {
    // Flux interrompu par le client : rien à relayer d'un corps tronqué.
    return json({ error: "invalid json body" }, 400, cors);
  }
  if (brut === null) {
    log.warn("payload too large", { max: MAX_BODY_BYTES });
    return json({ error: "payload too large" }, 413, cors);
  }
  return relayer("logs", req, brut, cors);
}
