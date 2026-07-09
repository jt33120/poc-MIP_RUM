// GET /api/extension/resolve?domain=<host> — résolution PUBLIQUE en lecture seule
// pour le service worker de l'extension navigateur (Ext-B). Aucun secret : le
// bundle d'une extension distribuée est lisible par l'utilisateur, donc pas de
// jeton à y mettre. Le modèle de sécurité repose sur le registre serveur
// (extension_scope) : un domaine non enregistré (ou inactif) renvoie 404, et
// l'extension n'injecte STRICTEMENT rien dans ce cas (jamais de <all_urls>
// silencieux). CORS permissif (GET, sans credentials) : c'est un mapping
// domaine -> app_id, zéro PII.
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/api/ratelimit";
import { resolveExtensionScope } from "@/lib/queries-extension-scope";

export const dynamic = "force-dynamic";

const LIMIT = Number(process.env.EXTENSION_RESOLVE_RATE_LIMIT ?? 120); // req/min/domaine
const WINDOW_MS = 60_000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

function err(status: number, message: string, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { ...CORS, ...extra } });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = (new URL(req.url).searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!domain) return err(400, "domain requis");

  const rl = rateLimit(`ext-resolve:${domain}`, LIMIT, WINDOW_MS, Date.now());
  if (!rl.ok) return err(429, "trop de requêtes", { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) });

  const scope = await resolveExtensionScope(domain);
  if (!scope) return err(404, "domaine non enregistré");

  return NextResponse.json(
    { app_id: scope.app_id, endpoint: scope.endpoint, active: scope.active },
    { headers: { ...CORS, "cache-control": "public, max-age=60" } },
  );
}
