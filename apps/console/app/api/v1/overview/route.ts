// GET /api/v1/overview — vue d'ensemble : health score (+ facteurs + anomalies),
// vitals p75 et compteurs, avec la période PRÉCÉDENTE pour calculer les deltas côté front.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { healthScore } from "@/lib/health";
import { overviewStats, vitalsP75 } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => {
  const f = filters.legacy;
  const [health, vitals, vitalsPrev, stats, statsPrev] = await Promise.all([
    healthScore(f),
    vitalsP75(f),
    vitalsP75(f, true),
    overviewStats(f),
    overviewStats(f, true),
  ]);
  return {
    health,
    vitals: { current: vitals, previous: vitalsPrev },
    stats: { current: stats, previous: statsPrev },
  };
});
