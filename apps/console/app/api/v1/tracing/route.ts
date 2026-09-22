// GET /api/v1/tracing — couverture du tracing distribué : taux de sessions tracées,
// appels API (front→back) et routes backend (p75 durée, taux d'erreur).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { apiCalls, backRoutes, traceCoverage } from "@/lib/queries-tracing";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => {
  const f = filters.legacy;
  const [{ total, correlated, back_total, front_p75, back_p75 }, calls, routes] = await Promise.all([
    traceCoverage(f),
    apiCalls(f),
    backRoutes(f),
  ]);
  // Contrat v1 figé (schéma OpenAPI `TraceCoverage`) : projection explicite des
  // cinq champs publiés. `err`, ajouté pour la tuile d'écran « Appels en échec »
  // (F59), ne fuit pas dans l'API — et un champ futur non plus, par construction.
  const coverage = { total, correlated, back_total, front_p75, back_p75 };
  return { coverage, apiCalls: calls, backRoutes: routes };
});
