// CE QU'UNE SERVER ACTION FAIT D'UN REFUS DE COMMANDE, quand il ne dépend pas d'elle.
//
// Sans session, on se reconnecte ; un rôle insuffisant revient à l'accueil —
// exactement ce que faisait `requireAdmin` avant C6. Les autres refus (démo,
// application hors périmètre, entrée invalide) appartiennent à l'écran, qui les
// dit à sa façon : la fonction rend la main.
import { redirect } from "next/navigation";
import type { RefusCommande } from "@mip/console-contract";

export function apresRefus(r: RefusCommande): void {
  if (r.code === "session_requise") redirect("/login");
  if (r.code === "role_insuffisant") redirect("/");
}
