// LA LECTURE DU PANNEAU D'UN GROUPE D'ERREURS (F20) — `panel=error:<empreinte>` sur
// `/errors`. Déplacée du composant (`components/errors/PanneauErreur.tsx`) vers la
// couche de données : le chargeur de `/errors` la lance pour le groupe ouvert ;
// le composant ne fait plus que rendre.
//
// Un groupe n'est pas dans la ligne de liste (ni sa tendance, ni ses releases, ni
// ses occurrences) : le panneau les lit, chacune indépendamment (§ 3.8), sur la
// plage de l'écran.
import type { PartGroupe } from "@/components/errors/DetailErreur";
import type { Filters } from "../filters";
import { listDeploys } from "../queries-deploys";
import { errorGroupDetail, partSessionsTouchees, releasesDuGroupe, type ErrorFilters, type ErrorGroupRef } from "../queries-errors";
import { UnsupportedFilterError } from "../query-compiler";
import { section } from "./commun";

/** Occurrences lues pour le bloc 5 et le bouton de rejeu : le panneau n'en liste aucune. */
const OCCURRENCES_DU_PANNEAU = 100;

export async function lirePanneauErreur(groupe: ErrorGroupRef, f: ErrorFilters, filtres: Filters) {
  const fGroupe: ErrorFilters = { ...f, app: groupe.app_id };
  const [detail, part, releases, deploys] = await Promise.all([
    section(() => errorGroupDetail(groupe, fGroupe, { limit: OCCURRENCES_DU_PANNEAU, cursor: null })),
    section<PartGroupe>(async () => {
      try {
        return { lu: await partSessionsTouchees(fGroupe, groupe) };
      } catch (e) {
        if (e instanceof UnsupportedFilterError) return { refus: e.message };
        throw e;
      }
    }),
    section(() => releasesDuGroupe(groupe, fGroupe)),
    section(() => listDeploys({ ...filtres, app: groupe.app_id }, 20)),
  ]);
  return { detail, part, releases, deploys };
}

export type LecturePanneauErreur = Awaited<ReturnType<typeof lirePanneauErreur>>;
