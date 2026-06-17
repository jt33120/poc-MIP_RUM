// GET /api/v1/pages — routes (pages) les plus lentes : p75 LCP/INP, volume, part mobile.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { slowRoutes } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => ({
  routes: await slowRoutes(filters.legacy),
}));
