// GET /api/extension/resolve?domain=<host> — résolution PUBLIQUE en lecture seule
// pour le service worker de l'extension navigateur (Ext-B). Aucun secret : le
// bundle d'une extension distribuée est lisible par l'utilisateur, donc pas de
// jeton à y mettre. Le modèle de sécurité repose sur le registre serveur
// (extension_scope) : un domaine non enregistré (ou inactif) renvoie 404, et
// l'extension n'injecte STRICTEMENT rien dans ce cas. CORS permissif (GET, sans
// credentials) : c'est un mapping domaine -> app_id, zéro PII.
//
// Depuis C12 (06/10/2026), la console RELAIE la résolution au collector, qui
// sert la même route (`/v1/extension/resolve`) et lit le registre ; elle ne
// fait que compléter l'`endpoint` de sa réponse (`lib/extension-resolution.ts`).
import { NextResponse, type NextRequest } from "next/server";
import { lireDomaine } from "@mip/backend/lib/extension-parc.mjs";
import { completerResolutionRelayee } from "@/lib/extension-resolution";
import { relayer } from "@/lib/ingest-relay";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest): Promise<Response> {
  // Un nom d'hôte, ou rien : une chaîne arbitraire ne part pas à Railway.
  if (!lireDomaine(new URL(req.url).searchParams.get("domain"))) {
    return NextResponse.json({ error: "domain requis" }, { status: 400, headers: CORS });
  }
  // P6b.G : collecte directe ouverte, l'adresse du collector remplace un
  // `endpoint` vide dans la réponse relayée.
  return completerResolutionRelayee(await relayer("extensionResolve", req, new Uint8Array(), CORS));
}
