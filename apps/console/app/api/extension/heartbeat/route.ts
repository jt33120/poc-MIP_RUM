// POST /api/extension/heartbeat — déclaration d'une installation de l'extension
// navigateur (Ext-D). Alimente l'inventaire de parc (/admin/extension-installs).
//
// PUBLIQUE ET NON AUTHENTIFIÉE, comme /resolve et pour la même raison : le bundle
// d'une extension distribuée est lisible par son utilisateur, donc aucun secret
// ne peut y être embarqué. La conséquence est assumée et bornée : n'importe qui
// peut inventer un install_id et faire apparaître une ligne fantôme. C'est un
// bruit d'inventaire, pas une fuite — la route ne LIT rien et n'écrit que dans
// ses deux tables. Le débit est plafonné par install_id ET globalement, et
// `app_ids` est filtré contre `extension_scope` : un poste ne peut se déclarer
// que sur des applications RÉELLEMENT servies par l'extension, jamais sur une
// application choisie par l'appelant.
//
// C11 — le collector sert la même route (`/v1/extension/heartbeat`) : la lecture
// du battement et son écriture sont partagées (`@mip/backend/lib/extension-parc.mjs`).
// Le relais d'ingestion la lui transmet quand il est allumé, User-Agent compris.
import { NextResponse, type NextRequest } from "next/server";
import { LIMITES_EXTENSION, lireBattement } from "@mip/backend/lib/extension-parc.mjs";
import { lireCorpsBorne } from "@mip/backend/shared/limits.mjs";
import { rateLimit } from "@/lib/api/ratelimit";
import { relayer } from "@/lib/ingest-relay";
import { recordInstallBeat } from "@/lib/queries-extension-installs";

export const dynamic = "force-dynamic";

// 4 battements/jour attendus par poste ; 12/h laisse la place aux redémarrages du
// service worker sans ouvrir la porte à une boucle.
const LIMIT = Number(process.env.EXTENSION_HEARTBEAT_RATE_LIMIT ?? LIMITES_EXTENSION.battementsParHeure);
const WINDOW_MS = 60 * 60 * 1000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function err(status: number, message: string, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { ...CORS, ...extra } });
}

export async function OPTIONS(): Promise<NextResponse> {
  // Le préflight est obligatoire ici : POST + content-type: application/json
  // depuis un service worker d'extension n'est pas une requête simple.
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Lu en OCTETS et borné, comme le collector ; puis JSON et identifiant UUID :
  // les mêmes refus des deux côtés (contrat de parité).
  const corps = await lireCorpsBorne(req.body as AsyncIterable<Uint8Array> | null, LIMITES_EXTENSION.corpsBattement);
  if (!corps) return err(413, "corps trop volumineux");
  const lu = lireBattement(new TextDecoder().decode(corps));
  if (lu.erreur !== undefined) return err(lu.statut, lu.erreur);

  const relayee = await relayer("extensionHeartbeat", req, corps, CORS);
  if (relayee) return relayee;

  const { installId, version, label, appIds } = lu.battement;
  const rl = rateLimit(`ext-beat:${installId}`, LIMIT, WINDOW_MS, Date.now());
  if (!rl.ok) return err(429, "trop de requêtes", { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) });

  // L'User-Agent de CETTE requête, pas une donnée envoyée par le client : même
  // information que rum_session.user_agent, une source de moins à faire confiance.
  const ua = req.headers.get("user-agent");

  await recordInstallBeat({ installId, label, version, ua, appIds });

  return NextResponse.json({ ok: true }, { headers: CORS });
}
