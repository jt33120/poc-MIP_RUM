// POST /api/extension/heartbeat — déclaration d'une installation de l'extension
// navigateur (Ext-D). Alimente l'inventaire de parc (/admin/extension-installs).
//
// PUBLIQUE ET NON AUTHENTIFIÉE, comme /resolve et pour la même raison : le bundle
// d'une extension distribuée est lisible par son utilisateur, donc aucun secret
// ne peut y être embarqué.
//
// Depuis C12 (06/10/2026), la console RELAIE le battement au collector, qui sert
// la même route (`/v1/extension/heartbeat`) : lecture du battement, débit par
// poste, filtrage de `app_ids` contre `extension_scope` et écriture sont les
// siens (`@mip/backend/lib/extension-parc.mjs`). User-Agent transmis : il
// l'inscrit à l'inventaire.
import { NextResponse, type NextRequest } from "next/server";
import { LIMITES_EXTENSION } from "@mip/backend/lib/extension-parc.mjs";
import { lireCorpsBorne } from "@mip/backend/shared/limits.mjs";
import { relayer } from "@/lib/ingest-relay";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function OPTIONS(): Promise<NextResponse> {
  // Le préflight est obligatoire ici : POST + content-type: application/json
  // depuis un service worker d'extension n'est pas une requête simple. CORS
  // fixe et ouvert : rien à demander au collector.
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Lu en OCTETS et borné, au plafond du collector : un corps trop gros ne part pas.
  const corps = await lireCorpsBorne(req.body as AsyncIterable<Uint8Array> | null, LIMITES_EXTENSION.corpsBattement);
  if (!corps) return NextResponse.json({ error: "corps trop volumineux" }, { status: 413, headers: CORS });
  return relayer("extensionHeartbeat", req, corps, CORS);
}
