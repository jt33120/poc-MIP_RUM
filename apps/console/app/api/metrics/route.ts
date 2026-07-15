// GET /api/metrics — exposition Prometheus de la santé INTERNE de MIP RUM (P1).
// Auth par token (header Authorization: Bearer <METRICS_TOKEN>). Si METRICS_TOKEN
// n'est pas défini, l'endpoint est DÉSACTIVÉ (404) — fail-closed : pas d'exposition
// involontaire d'indicateurs opérationnels. Pas de PII (compteurs agrégés).
import { bearerMatches } from "@/lib/api/auth";
import { internalHealth } from "@/lib/queries-health";
import { healthToMetrics, toPrometheus } from "@/lib/metrics-format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return new Response("metrics endpoint disabled (set METRICS_TOKEN)", { status: 404 });

  // comparaison à temps constant (évite l'oracle de chronométrage sur le token)
  if (!bearerMatches(req.headers.get("authorization"), token))
    return new Response("unauthorized", { status: 401 });

  const body = toPrometheus(healthToMetrics(await internalHealth()));
  return new Response(body, {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}
