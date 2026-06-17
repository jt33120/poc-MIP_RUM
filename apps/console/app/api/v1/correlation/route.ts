// GET /api/v1/correlation — corrélation front/back par route (vitals vs durée API) +
// angles morts (routes vues côté front sans tracing back, ou l'inverse).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { blindSpots, correlationCards } from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => {
  const f = filters.v2;
  const [cards, blind] = await Promise.all([correlationCards(f), blindSpots(f)]);
  return { cards, blindSpots: blind };
});
