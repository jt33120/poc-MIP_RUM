// GET /api/v1/ai/costs?group_by=user|model|route — coût IA agrégé par dimension.
// Nouveauté UTI-B : le coût PAR UTILISATEUR (user_hash anonymisé), pour le tableau
// « argent utilisé par utilisateur » (ex. génération de CV). group_by=model|route
// réutilise les agrégats existants. La dimension est validée par allowlist
// (lib/ai-costs) — aucune valeur utilisateur ne touche le SQL. Filtre v2 (app/période).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { parseCostDimension } from "@/lib/ai-costs";
import { aiByModel, aiByRoute, aiCostByUser, aiCostUnattributed } from "@/lib/queries-ai";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export const GET = handle(async ({ filters, searchParams }) => {
  const f = filters.v2;
  const group_by = parseCostDimension(searchParams.get("group_by"));

  if (group_by === "model") return { group_by, rows: await aiByModel(f) };
  if (group_by === "route") return { group_by, rows: await aiByRoute(f) };

  // group_by === "user" (défaut) : coût par utilisateur + bucket non attribuable.
  const limit = clampInt(searchParams.get("limit"), 100, 1, 500);
  const [rows, unattributed] = await Promise.all([aiCostByUser(f, limit), aiCostUnattributed(f)]);
  return { group_by, rows, unattributed };
});
