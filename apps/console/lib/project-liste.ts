// Les projets visibles par un principal — SANS rien de Next (ni cookie, ni en-tête).
//
// Séparé de `project.ts` (qui lit le cookie du projet courant) pour que le
// chargeur de la coquille (`chargeurs/coquille.ts`) s'embarque tel quel dans
// console-api. `project.ts` le réexporte : ses appelants n'ont rien changé.
import type { SessionUser } from "./auth";
import { listApps, type AppItem } from "./queries";
import { authorizedAppsOf } from "./query-contract";

/** Projets visibles par l'utilisateur (RBAC : viewer scopé à ses apps ; liste vide = aucun). */
export async function projectsForUser(user: Pick<SessionUser, "role" | "apps">): Promise<AppItem[]> {
  const all = await listApps();
  const authorized = authorizedAppsOf(user);
  return authorized === null ? all : all.filter((a) => authorized.includes(a.app_id));
}
