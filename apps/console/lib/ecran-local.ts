// UN ÉCRAN, CHARGÉ PAR LA CONSOLE ELLE-MÊME (jusqu'à la bascule vers console-api).
//
// La page appelle son chargeur ici, avec le principal de la SESSION, et reçoit sa
// sortie passée par JSON (`versLeFil`) : la forme exacte que console-api rendra.
// C'est le point unique de la bascule (après P6b) : ce module appellera alors
// l'opération de l'écran (`ECRANS` du contrat) au lieu du chargeur, et aucune page
// n'aura à changer de type. Il lit la session : il ne part jamais dans le bundle
// de console-api (la garde du build refuse `lib/auth.ts`).
import { cookies } from "next/headers";
import type { Fil } from "@mip/console-contract";
import { getUser } from "./auth";
import { PARAM_BLOCS, versLeFil, type Chargeur, type CheminEcran, type ParametresEcran } from "./chargeurs/commun";
import { catalogueDe } from "./dashboard-blocs";

export async function chargerEcran<R>(chargeur: Chargeur<R>, sp: ParametresEcran, chemin: CheminEcran = {}): Promise<Fil<R>> {
  return versLeFil(await chargeur(await getUser(), sp, chemin));
}

/**
 * Les paramètres d'un écran COMPOSABLE (`/`, `/sessions`, `/slo`), augmentés de sa
 * composition : le cookie du catalogue, passé au chargeur sous `blocs`. Une valeur
 * de l'URL sous ce nom est écartée — la composition est celle du cookie.
 */
export async function avecBlocs(sp: ParametresEcran, href: string): Promise<ParametresEcran> {
  const cat = catalogueDe(href);
  if (!cat) throw new Error(`écran sans catalogue de blocs : ${href}`);
  const { [PARAM_BLOCS]: _ignore, ...reste } = sp;
  const brut = (await cookies()).get(cat.cookie)?.value;
  return brut === undefined ? reste : { ...reste, [PARAM_BLOCS]: brut };
}
