// PATCH / DELETE /api/v1/explorer/views/{id} — une vue enregistrée (P6.5).
//
// PROPRIÉTAIRE SEUL. Un admin LIT les vues de ses apps, mais ne renomme ni ne
// supprime l'analyse personnelle d'un autre : la gestion transverse porterait sur
// du travail privé, pas sur une ressource partagée.
//
// RÉVISION CITÉE. `expectedRevision` est obligatoire : une écriture fondée sur
// une lecture périmée est refusée (409) avec la révision courante, jamais
// appliquée par-dessus le travail d'un autre onglet.
import { handleMutation } from "@/lib/api/handle";
import { preflight, ApiHttpError } from "@/lib/api/respond";
import { valeurOuErreur, vuePublique } from "@/lib/api/saved-views";
import { savedViewErrorStatus, parseSavedViewPatch } from "@/lib/saved-views";
import { deleteSavedView, savedViewReader, updateSavedView } from "@/lib/queries-saved-views";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const PATCH = handleMutation(
  async ({ user, body, params }) => {
    const demande = parseSavedViewPatch(body, { principal: user, nowMs: Date.now() });
    if (!demande.ok) {
      const { code, message, parameter } = demande.error;
      throw new ApiHttpError(savedViewErrorStatus(demande.error), message, {
        code,
        ...(parameter ? { parameter } : {}),
      });
    }
    const reader = await savedViewReader(user);
    const view = valeurOuErreur(await updateSavedView(reader, params.id ?? "", demande.value));
    return { app: view.app_id, data: { view: vuePublique(view) } };
  },
  { role: "session" },
);

export const DELETE = handleMutation(
  async ({ user, params }) => {
    const reader = await savedViewReader(user);
    const { app } = valeurOuErreur(await deleteSavedView(reader, params.id ?? ""));
    return { app, data: { deleted: true } };
  },
  // Une suppression ne porte pas de corps : l'identifiant et la session suffisent.
  { role: "session", body: false },
);
