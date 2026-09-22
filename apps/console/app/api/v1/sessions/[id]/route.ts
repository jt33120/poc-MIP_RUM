// GET /api/v1/sessions/{id} — métadonnées d'une session + sa timeline (pageviews,
// erreurs, longtasks, appels API…). 404 si la session est inconnue.
import { handle } from "@/lib/api/handle";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { sessionMeta, sessionTimeline } from "@/lib/queries";
import { authorizedAppsOf } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal, params }) => {
  const meta = await sessionMeta(params.id);
  if (!meta) throw new ApiHttpError(404, "session introuvable");
  // RBAC : un viewer scopé ne lit que les sessions de ses apps (liste vide = aucune).
  const authorized = authorizedAppsOf(principal);
  if (authorized !== null && !authorized.includes(meta.app_id)) throw new ApiHttpError(404, "session introuvable");
  // Bornée à l'app de la session : session_id est émis par le client.
  const timeline = await sessionTimeline(params.id, meta.app_id);
  return { meta, timeline };
});
