// GET /api/v1/errors — groupes d'erreurs (par fingerprint) + nombre d'erreurs v0.1
// non groupables (sans fingerprint). Utilise les filtres v2 (app 'all', device 'all').
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { errorGroups, unfingerprintedCount } from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters }) => {
  const f = filters.v2;
  const [groups, unfingerprinted] = await Promise.all([
    errorGroups(f),
    unfingerprintedCount(f),
  ]);
  return { groups, unfingerprinted };
});
