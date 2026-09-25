// Filtres d'un écran de la console (P6.2), pour une PAGE : le principal vient de
// la session. Le cœur — périmètre, plage, filtres, capacités de l'écran — est
// dans `lib/filtres-ecran.ts`, sans session : les chargeurs d'écrans
// (`lib/chargeurs/`) l'appellent avec le principal qu'ils reçoivent, dans la
// console comme dans console-api.
import { getUser } from "./auth";
import { analyserFiltres, type PageFilters } from "./filtres-ecran";
import type { SearchParams } from "./filters";

export type { FilterProblem, PageFilters } from "./filtres-ecran";

export async function pageFilters(sp: SearchParams | undefined, pathname: string): Promise<PageFilters> {
  return analyserFiltres(await getUser(), sp, pathname);
}
