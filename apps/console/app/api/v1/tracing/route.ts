// GET /api/v1/tracing — couverture du tracing distribué : taux de sessions tracées,
// appels API (front→back) et routes backend (p75 durée, taux d'erreur).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { apiCalls, backRoutes, traceCoverage } from "@/lib/queries-tracing";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => {
  const f = filters.legacy;
  const [coverage, calls, routes] = await Promise.all([
    traceCoverage(f),
    apiCalls(f),
    backRoutes(f),
  ]);
  return { coverage, apiCalls: calls, backRoutes: routes };
});
