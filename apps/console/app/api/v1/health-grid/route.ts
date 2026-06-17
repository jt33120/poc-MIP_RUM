// GET /api/v1/health-grid — heatmap de santé (cellule = une heure, jour×heure) +
// trafic quotidien (sessions/pages/erreurs). Alimente les graphes « grid » de la console.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { dailyTraffic, healthGrid } from "@/lib/queries-grid";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => {
  const f = filters.legacy;
  const [grid, traffic] = await Promise.all([healthGrid(f), dailyTraffic(f)]);
  return { grid, dailyTraffic: traffic };
});
