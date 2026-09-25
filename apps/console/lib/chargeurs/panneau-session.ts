// LA LECTURE DU PANNEAU DE SESSION (F43) — `panel=session:<id>` sur `/sessions`.
//
// Déplacée du composant (`components/sessions/PanneauSession.tsx`) vers la couche
// de données : le chargeur de `/sessions` la lance EN MÊME TEMPS que ses propres
// lectures, dans la console comme dans console-api ; le composant ne fait plus
// que rendre ce qui a été lu.
//
// RIEN N'EST LU AVANT LA GARDE : une app que l'écran ne lit pas (périmètre du
// principal, app demandée) rend « introuvable », sans rien lire de plus — ni
// chronologie, ni rejeu. `introuvable` couvre l'absence ET le hors-périmètre : les
// distinguer dirait qu'une session existe dans une app qu'on ne peut pas lire.
import type { Section } from "@mip/console-contract";
import { lire } from "../lecture";
import { sessionDansLePerimetre } from "../panneau-session";
import { sessionMeta, sessionTimeline, type SessionMeta, type TimelineItem } from "../queries";
import { sessionARejeu } from "../session-rejeu";
import { section } from "./commun";

export type LecturePanneauSession =
  | { etat: "introuvable" }
  | { etat: "echec"; id: string }
  | { etat: "lue"; meta: SessionMeta; timeline: Section<TimelineItem[]>; rejeu: Section<boolean> };

/**
 * Lecture du panneau, garde comprise. `effectiveApps` = les apps que l'écran lit
 * (`query.scope.effectiveApps`) : le périmètre signé du principal ET l'app demandée,
 * la même garde que `app/sessions/[id]/page.tsx`. Ne lève pas : un échec de lecture
 * devient `echec` (jamais « introuvable », qui affirmerait une absence non lue).
 */
export async function lirePanneauSession(
  id: string,
  effectiveApps: readonly string[] | null,
): Promise<LecturePanneauSession> {
  const lue = await lire(() => sessionMeta(id));
  if (!lue.ok) return { etat: "echec", id };
  const meta = lue.data;
  if (meta === null || !sessionDansLePerimetre(meta.app_id, effectiveApps)) return { etat: "introuvable" };
  // Lues APRÈS la garde, et bornées à l'app de la session (V7) : une ligne d'une
  // autre app qui citerait le même identifiant (émis par le client) n'y entre pas.
  const [timeline, rejeu] = await Promise.all([
    section(() => sessionTimeline(meta.session_id, meta.app_id)),
    section(() => sessionARejeu(meta.session_id, meta.app_id)),
  ]);
  return { etat: "lue", meta, timeline, rejeu };
}
