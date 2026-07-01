// GET /api/v1/errors/{fingerprint} — détail d'un groupe d'erreurs : groupe, dernier
// échantillon (stack), occurrences récentes. 404 si le fingerprint est inconnu (sur scope).
import { handle } from "@/lib/api/handle";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { errorGroupDetail } from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, params }) => {
  const detail = await errorGroupDetail(params.fingerprint, filters.v2);
  if (!detail) throw new ApiHttpError(404, "groupe d'erreurs introuvable");
  return detail;
});
