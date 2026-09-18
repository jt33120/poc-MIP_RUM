// GET / POST /api/v1/explorer/views — vues enregistrées de l'Explorer (P6.5).
//
// GET : les vues LISIBLES par la session — les siennes, plus celles de ses apps
// si elle est admin. Un jeton d'API est refusé : une vue est personnelle, et un
// jeton ne doit jamais exposer le travail privé d'un opérateur.
//
// POST : session non démo, dans une app de son périmètre, 50 vues au plus par
// app. L'AST est validé par le registre de l'Explorer puis rendu canonique : ce
// qui est stocké est exactement ce que `POST /explorer/query` sait rejouer.
import { handle, handleMutation } from "@/lib/api/handle";
import { preflight, ApiHttpError } from "@/lib/api/respond";
import { refuserJeton, valeurOuErreur, vuePublique } from "@/lib/api/saved-views";
import { savedViewErrorStatus, parseSavedViewCreate } from "@/lib/saved-views";
import { createSavedView, listSavedViews, savedViewReader } from "@/lib/queries-saved-views";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal, filters }) => {
  refuserJeton(principal);
  const reader = await savedViewReader({
    email: principal.subject,
    role: principal.role,
    apps: principal.apps,
  });
  const views = valeurOuErreur(await listSavedViews(reader, { app: filters.app }));
  return { views: views.map(vuePublique) };
});

export const POST = handleMutation(
  async ({ user, body }) => {
    const demande = parseSavedViewCreate(body, { principal: user, nowMs: Date.now() });
    if (!demande.ok) {
      const { code, message, parameter } = demande.error;
      throw new ApiHttpError(savedViewErrorStatus(demande.error), message, {
        code,
        ...(parameter ? { parameter } : {}),
      });
    }
    const reader = await savedViewReader(user);
    const view = valeurOuErreur(await createSavedView(reader, demande.value));
    return { app: view.app_id, data: { view: vuePublique(view) }, status: 201 };
  },
  // Une vue est une écriture PERSONNELLE : un viewer enregistre les siennes dans
  // son périmètre, exactement comme il crée déjà ses propres tableaux de bord.
  { role: "session" },
);
