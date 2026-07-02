// GET /api/v1/openapi — spec OpenAPI 3.0 (JSON) de l'API v1, PUBLIQUE (le contrat n'est
// pas secret ; à brancher dans Swagger UI / générateurs de clients). Construite en code
// par lib/api/openapi.ts (fonction pure).
import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders } from "@/lib/api/cors";
import { preflight } from "@/lib/api/respond";
import { buildOpenApi } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(req: NextRequest) {
  return NextResponse.json(buildOpenApi(), {
    headers: { ...corsHeaders(req.headers.get("origin")), "Cache-Control": "public, max-age=3600" },
  });
}
