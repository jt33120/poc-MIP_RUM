// GET /api/v1/sessions — sessions récentes (filtres globaux app/period/device).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { listSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => ({
  sessions: await listSessions(filters.legacy),
}));
