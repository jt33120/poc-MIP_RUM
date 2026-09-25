// GET /api/v1/explorer/views — vues enregistrées de l'Explorer (P6.5).
//
// Les vues LISIBLES par la session — les siennes, plus celles de ses apps si elle
// est admin. Un jeton d'API est refusé : une vue est personnelle, et un jeton ne
// doit jamais exposer le travail privé d'un opérateur.
//
// Les écritures (créer, renommer, supprimer) ont quitté l'API publique en C7 :
// elles passent par l'écran de la console (`app/explorer/actions.ts`), dont les
// server actions appellent leurs commandes (`lib/commandes/vues.ts`).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { refuserJeton, valeurOuErreur, vuePublique } from "@/lib/api/saved-views";
import { listSavedViews, savedViewReader } from "@/lib/queries-saved-views";

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
