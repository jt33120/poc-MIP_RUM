// GET /api/v1/errors — groupes d'erreurs (par fingerprint) + nombre d'erreurs v0.1 non
// groupables (sans fingerprint). Filtres v2 (app 'all', device 'all') + pagination limit/offset.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { parsePagination } from "@/lib/api/pagination";
import { errorGroups, unfingerprintedCount } from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const f = filters.v2;
  const page = parsePagination(searchParams, 100);
  const [groups, unfingerprinted] = await Promise.all([
    errorGroups(f, page),
    unfingerprintedCount(f),
  ]);
  return { groups, unfingerprinted, page };
});
