// Actions d'une vue enregistrée (F34, W-V3, plan § 5.22.4). Rendu serveur.
//
// CE QUI N'EST PAS RENDU N'A PAS À ÊTRE REFUSÉ (V9). Une session de démonstration
// est en lecture seule : le middleware refuserait ses écritures, mais un bouton
// qui échoue est une promesse non tenue — il n'est donc pas rendu, et la ligne dit
// pourquoi. Même règle pour une vue d'un autre compte : seul son propriétaire la
// renomme ou la supprime.
//
// SUPPRIMER SE FAIT EN DEUX TEMPS. Le premier geste (« Supprimer… ») ouvre un
// `<details>` ; le second (« Confirmer la suppression ») écrit. Aucune couleur de
// verdict sur ces boutons (CE11, P15) : le rouge dit l'état d'une mesure, pas un geste.
import { INPUT_CLASS } from "@/components/forms/Field";
import type { SavedViewRow } from "@/lib/queries-saved-views";
import { SAVED_VIEW_NAME_MAX } from "@/lib/saved-views";
import { deleteViewAction, renameViewAction } from "@/app/explorer/actions";

export function ActionsVue({
  vue,
  demo,
}: {
  vue: Pick<SavedViewRow, "id" | "name" | "revision" | "mine">;
  /** Session ouverte par /demo : lecture seule, aucun bouton d'écriture. */
  demo: boolean;
}) {
  if (demo) {
    return (
      <p className="text-right text-xs text-ink-soft" data-testid="vue-lecture-seule">
        Session de démonstration : lecture seule.
      </p>
    );
  }
  if (!vue.mine) {
    return (
      <p className="text-right text-xs text-ink-soft" data-testid="vue-lecture-seule">
        Lecture seule : une vue n’est modifiable que par son propriétaire.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <form action={renameViewAction} className="flex items-end gap-1">
        <input type="hidden" name="id" value={vue.id} />
        <input type="hidden" name="revision" value={vue.revision} />
        <label className="flex flex-col gap-1 text-[11px] text-ink-soft">
          <span className="sr-only">Nouveau nom de « {vue.name} »</span>
          <input
            name="name"
            required
            maxLength={SAVED_VIEW_NAME_MAX}
            defaultValue={vue.name}
            aria-label={`Nouveau nom de ${vue.name}`}
            className={`${INPUT_CLASS} w-40`}
          />
        </label>
        <button type="submit" className="btn-ghost">
          Renommer
        </button>
      </form>
      <details data-testid="vue-supprimer">
        <summary className="btn-ghost cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf [&::-webkit-details-marker]:hidden">
          Supprimer…
          <span className="sr-only"> la vue « {vue.name} »</span>
        </summary>
        <form action={deleteViewAction} className="mt-2 flex flex-col items-end gap-1">
          <input type="hidden" name="id" value={vue.id} />
          <p className="max-w-[14rem] text-right text-xs text-ink-soft">
            La vue sera effacée ; l’analyse reste composable dans l’Explorer.
          </p>
          <button type="submit" aria-label={`Confirmer la suppression de ${vue.name}`} className="btn-ghost">
            Confirmer la suppression
          </button>
        </form>
      </details>
    </div>
  );
}
