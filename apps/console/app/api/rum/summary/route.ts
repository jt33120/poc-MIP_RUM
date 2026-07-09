// GET /api/rum/summary — API de LECTURE propriétaire (livrable UTI). Auth par
// token en base (Authorization: Bearer), SCOPÉ à un app_id : un token ne peut lire
// que son app. Renvoie des agrégats TECHNIQUES uniquement (aucune PII). Appel
// serveur-à-serveur (le token reste côté backend client).
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/api/ratelimit";
import { resolveReadToken } from "@/lib/queries-read-tokens";
import { rumSummary } from "@/lib/queries-summary";
import { parseWindow } from "@/lib/read-tokens";

export const dynamic = "force-dynamic";

const LIMIT = Number(process.env.RUM_READ_RATE_LIMIT ?? 60); // req/min/token
const WINDOW_MS = 60_000;

function err(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  const token = bearer?.[1]?.trim();
  if (!token) return err(401, "token requis (Authorization: Bearer <token>)");

  const resolved = await resolveReadToken(token);
  if (!resolved) return err(401, "token invalide ou révoqué");

  const url = new URL(req.url);
  const app = (url.searchParams.get("app") ?? "").trim() || resolved.app_id;
  if (app !== resolved.app_id) return err(403, "ce token n'est pas autorisé pour cette app");

  const rl = rateLimit(`read:${resolved.id}`, LIMIT, WINDOW_MS, Date.now());
  if (!rl.ok) {
    const r = err(429, "trop de requêtes — réessaie dans un instant");
    r.headers.set("Retry-After", String(Math.ceil(rl.resetMs / 1000)));
    return r;
  }

  const { key, interval } = parseWindow(url.searchParams.get("window"));
  const data = await rumSummary(app, key, interval, new Date().toISOString());
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store", "RateLimit-Remaining": String(rl.remaining) },
  });
}
