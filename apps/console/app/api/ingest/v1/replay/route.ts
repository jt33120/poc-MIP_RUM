// POST /api/ingest/v1/replay — chunk rrweb (corps binaire gzip), RELAYÉ au
// collector. Contrat inchangé côté SDK : métadonnées en en-têtes x-mip-session /
// x-mip-app / x-mip-seq (+ x-mip-key), transmis tels quels.
//
// Depuis C12 (06/10/2026), la console n'écrit plus rien : les en-têtes, la clé,
// le débit, le gunzip de contrôle et l'écriture sont l'affaire du collector.
import { lireCorpsBorne, MAX_REPLAY_BYTES } from "@mip/backend/shared/limits.mjs";
import { REPLAY_ALLOW_HEADERS } from "@mip/backend/shared/cors.mjs";
import { corsSansBase, json, log, relayer } from "@/lib/ingest-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PLAFOND EXPLICITE de la fonction : 30 s (voir la route traces).
export const maxDuration = 30;

// Le préflight annonce les en-têtes x-mip-* (sinon le navigateur bloque le POST
// cross-origin des clients à clé) — ceux du collector, sur sa réponse.
const replayCors = (req: Request) => corsSansBase(req.headers.get("origin"), { allowHeaders: REPLAY_ALLOW_HEADERS });

export async function OPTIONS(req: Request) {
  return relayer("replay", req, new Uint8Array(), replayCors(req));
}

export async function POST(req: Request) {
  const cors = replayCors(req);
  let corps: Uint8Array | null;
  try {
    // Lecture BORNÉE au plafond du collector (2 Mio).
    corps = await lireCorpsBorne(req.body as unknown as AsyncIterable<Uint8Array> | null, MAX_REPLAY_BYTES);
  } catch (err) {
    // Flux interrompu : rien à relayer d'un corps tronqué.
    log.error("internal error", { err: String(err) });
    return json({ error: "internal error" }, 500, cors);
  }
  // Au-delà du plafond, la lecture s'est arrêtée : il n'y a plus d'octets
  // entiers à transmettre, et le collector refuserait de même.
  if (corps === null) return json({ error: "invalid payload size" }, 413, cors);
  return relayer("replay", req, corps, cors);
}
