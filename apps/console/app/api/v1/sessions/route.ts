// GET /api/v1/sessions — sessions récentes (filtres app/period/device + pagination limit/offset).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { parsePagination } from "@/lib/api/pagination";
import { listSessions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const page = parsePagination(searchParams, 50);
  const sessions = await listSessions(filters.legacy, page);
  return { sessions, page };
});
