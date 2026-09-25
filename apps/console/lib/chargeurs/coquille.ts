// LE CHARGEUR DE LA COQUILLE : ce que le layout racine lit pour chaque écran de
// console — les projets du principal, les colonnes de dimensions présentes, le
// fuseau de chaque projet, et (administrateur) l'entrée « Connecteurs de tickets ».
//
// UN CHARGEUR, DEUX APPELANTS (piste C). La console l'appelle aujourd'hui, en
// local ; console-api le sert (`GET /v1/shell`) en l'embarquant tel quel dans son
// bundle. Le jour de la bascule, le layout remplacera cet appel par celui du
// service : même code, même résultat — la parité n'est pas un test, c'est la
// construction.
//
// Rien ici ne lit la requête (ni cookie, ni en-tête) : le projet COURANT reste
// choisi par le layout (cookie `mip-project`), à partir des projets rendus.
// Chaque lecture passe par `lire()` : en échec, la coquille s'affiche sans elle et
// le dit (F02), jamais une erreur qui emporterait la console entière.
import type { SessionUser } from "../auth";
import { fuseauDe } from "../fuseau";
import { lire, type Lecture } from "../lecture";
import { projectsForUser } from "../project-liste";
import type { AppItem } from "../queries";
import { dimensionSchema } from "../query-schema";
import { surfaceTicketsOuverte } from "../queries-ticket-integrations";

export interface CoquilleChargee {
  readonly projets: Lecture<AppItem[]>;
  /** `table.colonne` des dimensions réellement présentes, triées. */
  readonly schema: Lecture<string[]>;
  /** Le fuseau de chaque projet du principal. */
  readonly fuseaux: Record<string, string>;
  /** L'entrée « Connecteurs de tickets » ; `null` pour qui n'est pas administrateur. */
  readonly tickets: Lecture<boolean> | null;
}

export async function chargerCoquille(user: Pick<SessionUser, "role" | "apps">): Promise<CoquilleChargee> {
  // RBAC : seulement les projets autorisés (viewer scopé ; liste vide = aucun).
  const projets = await lire(() => projectsForUser(user));
  const apps = projets.ok ? projets.data : [];
  const [schema, fuseaux, tickets] = await Promise.all([
    lire(() => dimensionSchema().then((colonnes) => [...colonnes].sort())),
    Promise.all(apps.map(async (a) => [a.app_id, await fuseauDe(a.app_id)] as const)).then(Object.fromEntries),
    // P8.6 : l'entrée n'apparaît que lorsqu'un fournisseur est branché et testé.
    user.role === "admin" ? lire(surfaceTicketsOuverte) : Promise.resolve(null),
  ]);
  return { projets, schema, fuseaux, tickets };
}
