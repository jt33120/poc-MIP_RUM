// GET /api/metrics — exposition Prometheus de la santé INTERNE de MIP RUM (P1).
// Auth par token (header Authorization: Bearer <METRICS_TOKEN>). Si METRICS_TOKEN
// n'est pas défini, l'endpoint est DÉSACTIVÉ (404) — fail-closed : pas d'exposition
// involontaire d'indicateurs opérationnels. Pas de PII (compteurs agrégés).
import { bearerMatches } from "@/lib/api/auth";
import { lire } from "@/lib/lecture";
import { internalHealth } from "@/lib/queries-health";
import { healthToMetrics, toPrometheus } from "@/lib/metrics-format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return new Response("metrics endpoint disabled (set METRICS_TOKEN)", { status: 404 });

  // comparaison à temps constant (évite l'oracle de chronométrage sur le token)
  if (!bearerMatches(req.headers.get("authorization"), token))
    return new Response("unauthorized", { status: 401 });

  // Lecture en échec : 503, jamais un instantané de zéros (F02). Des jauges à 0
  // pendant une panne diraient « aucune alerte, aucune file » ; un scrape en échec
  // passe `up` à 0, ce que Prometheus sait alerter. Le message d'exception reste
  // dans les journaux serveur (`lire`), pas dans la réponse.
  const sante = await lire(internalHealth);
  if (!sante.ok) {
    return new Response("lecture de la santé interne en échec", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "30" },
    });
  }
  const body = toPrometheus(healthToMetrics(sante.data));
  return new Response(body, {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}
