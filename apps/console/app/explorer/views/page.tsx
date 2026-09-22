// Vues enregistrées de l'Explorer (P6.5) — rendu 100 % serveur.
//
// CE QUE LA LISTE MONTRE. Les vues du compte connecté, plus — pour un admin —
// celles des autres comptes de ses apps. Aucune vue n'est publique : le périmètre
// est celui de la session, et une vue d'une app non autorisée n'apparaît pas.
//
// UNE VUE ILLISIBLE RESTE ÉDITABLE. Un AST écrit par une version antérieure du
// registre, ou devenu invalide depuis, n'est pas supprimé en silence : la ligne
// affiche sa raison, sans lien « ouvrir », et garde renommage et suppression.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { INPUT_CLASS } from "@/components/forms/Field";
import { getUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { explorerHrefFromAst } from "@/lib/explorer-page-params";
import { listSavedViews, savedViewReader } from "@/lib/queries-saved-views";
import { SAVED_VIEW_MAX_PER_APP, SAVED_VIEW_NAME_MAX } from "@/lib/saved-views";
import type { SearchParams } from "@/lib/filters";
import { deleteViewAction, renameViewAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Vues({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const user = await getUser();
  if (!user) return null;
  const sp = (await searchParams) ?? {};
  const reader = await savedViewReader(user);
  const result = await listSavedViews(reader);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Vues enregistrées"
        sub={`Analyses de l’Explorer conservées pour les rejouer. ${SAVED_VIEW_MAX_PER_APP} au plus par application ; elles restent personnelles — aucune n’est publique.`}
      >
        <Link href="/explorer" className="btn-ghost">
          ← Explorer
        </Link>
      </PageHeader>

      {sp.conflit === "1" && (
        <p role="alert" data-testid="vues-conflit" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Cette vue a changé depuis son affichage : rien n’a été écrit. La liste ci-dessous est à jour.
        </p>
      )}
      {sp.refus === "1" && (
        <p role="alert" data-testid="vues-refus" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Opération refusée : une vue enregistrée n’est modifiable que par son propriétaire, dans une application de
          son périmètre. Rien n’a été écrit.
        </p>
      )}
      {sp.plafond === "1" && (
        <p role="alert" data-testid="vues-plafond" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Plafond atteint : {SAVED_VIEW_MAX_PER_APP} vues enregistrées par application. En supprimer avant d’en
          ajouter.
        </p>
      )}

      {result.kind === "unavailable" && (
        <p role="status" data-testid="vues-indisponibles" className="card px-4 py-8 text-center text-sm text-ink-soft">
          Les vues enregistrées ne sont pas encore disponibles sur cette base : la migration v79 n’est pas appliquée.
          L’Explorer reste utilisable, et ses requêtes restent partageables par leur URL.
        </p>
      )}
      {result.kind === "forbidden" && (
        <p role="alert" className="card px-4 py-8 text-center text-sm text-ink-soft">
          {result.error}
        </p>
      )}

      {result.kind === "ok" && (
        // `overflow-x-auto` et non `overflow-hidden` : à 390 px, cinq colonnes
        // dont un champ de saisie ne tiennent pas. Les MASQUER rendrait le
        // renommage inatteignable ; les faire défiler le garde accessible.
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Vues enregistrées lisibles par ce compte</caption>
            <thead>
              <tr>
                <th scope="col" className="th text-left">Nom</th>
                <th scope="col" className="th text-left">App</th>
                <th scope="col" className="th text-left">Propriétaire</th>
                <th scope="col" className="th text-right">Mise à jour</th>
                <th scope="col" className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.value.map((vue) => {
                const ouvrir = explorerHrefFromAst(vue.query);
                return (
                  <tr key={vue.id} className="border-t border-line align-top hover:bg-panel2" data-testid={`vue-${vue.id}`}>
                    <td className="px-3 py-2 font-medium">
                      {ouvrir.ok ? (
                        <Link href={ouvrir.href} className="text-accent hover:underline">
                          {vue.name}
                        </Link>
                      ) : (
                        <>
                          <span className="text-ink">{vue.name}</span>
                          <p role="note" className="mt-1 max-w-sm break-words text-xs text-ink-faint">
                            Requête illisible : {ouvrir.reason}. La vue est conservée — la renommer ou la supprimer
                            reste possible.
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{vue.app_id}</td>
                    <td className="px-3 py-2 text-ink-soft">
                      {vue.mine ? "vous" : (vue.owner_email ?? "un autre compte")}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">
                      {fmtDate(vue.updated_at)}
                    </td>
                    <td className="px-3 py-2">
                      {vue.mine ? (
                        <div className="flex flex-wrap items-end justify-end gap-2">
                          <form action={renameViewAction} className="flex items-end gap-1">
                            <input type="hidden" name="id" value={vue.id} />
                            <input type="hidden" name="revision" value={vue.revision} />
                            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">
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
                          <form action={deleteViewAction}>
                            <input type="hidden" name="id" value={vue.id} />
                            {/* Bouton neutre (CE11, P15) : le rouge est réservé à l'état
                                d'une mesure, pas à un geste. */}
                            <button type="submit" aria-label={`Supprimer ${vue.name}`} className="btn-ghost">
                              Supprimer
                            </button>
                          </form>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-ink-faint">
                          Lecture seule : une vue n’est modifiable que par son propriétaire.
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!result.value.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-faint">
                    Aucune vue enregistrée — en composer une dans l’Explorer, puis l’enregistrer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
