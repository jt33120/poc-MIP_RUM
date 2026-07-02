// GET /api/v1/health — sonde de liveness (SANS auth) : confirme que l'API répond.
// Ne touche pas la DB (liveness pur, toujours 200 si le process tourne). La readiness
// (vérif DB) se fait via un simple appel authentifié à /api/v1/apps — cf. docs/DEPLOY_API.md.
import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders } from "@/lib/api/cors";
import { preflight } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(req: NextRequest) {
  return NextResponse.json(
    { status: "ok", service: "mip-rum-console-api", version: "1", generatedAt: new Date().toISOString() },
    { headers: { ...corsHeaders(req.headers.get("origin")), "Cache-Control": "no-store" } },
  );
}
