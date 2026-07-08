// GET /api/v1/ai — performance IA (feature IA) exposée à un client tiers (ex. front
// Admin UTI). Réutilise la couche data existante (queries-ai) : coût, tokens, latence
// p75 et taux d'erreur, en global + par modèle/route + série journalière + derniers
// appels (dont les ÉCHECS : status='error', error_type — ex. OpenRouter en échec).
// Filtre v2 (app/période ; rum_ai n'a pas de device). RBAC appliqué en amont.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { aiByModel, aiByRoute, aiDaily, aiOverview, recentAiCalls } from "@/lib/queries-ai";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Borne `n` dans [min, max] ; NaN -> `fallback`. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export const GET = handle(async ({ filters, searchParams }) => {
  const f = filters.v2;
  const recentLimit = clampInt(searchParams.get("recent"), 50, 0, 200);
  const [overview, byModel, byRoute, daily, recent] = await Promise.all([
    aiOverview(f),
    aiByModel(f),
    aiByRoute(f),
    aiDaily(f),
    recentLimit > 0 ? recentAiCalls(f, recentLimit) : Promise.resolve([]),
  ]);
  return { overview, byModel, byRoute, daily, recent };
});
