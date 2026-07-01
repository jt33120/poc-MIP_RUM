// GET /api/v1/sessions/{id} — métadonnées d'une session + sa timeline (pageviews,
// erreurs, longtasks, appels API…). 404 si la session est inconnue.
import { handle } from "@/lib/api/handle";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { sessionMeta, sessionTimeline } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal, params }) => {
  const meta = await sessionMeta(params.id);
  if (!meta) throw new ApiHttpError(404, "session introuvable");
  // RBAC : un viewer scopé ne lit que les sessions de ses apps.
  if (principal.apps?.length && !principal.apps.includes(meta.app_id))
    throw new ApiHttpError(404, "session introuvable");
  const timeline = await sessionTimeline(params.id);
  return { meta, timeline };
});
