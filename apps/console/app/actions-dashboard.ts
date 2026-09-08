"use server";
// Réglage des blocs d'un tableau de bord — écrit le cookie lu par la page.
// Une seule action pour tous les catalogues : le formulaire porte le href de la
// catégorie concernée. Aucune donnée sensible (des identifiants d'affichage),
// donc pas de httpOnly, mais un SameSite strict comme le reste du site.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { catalogueDe, serialiserChoix } from "@/lib/dashboard-blocs";

export async function reglerBlocsAction(fd: FormData): Promise<void> {
  const cat = catalogueDe(String(fd.get("catalogue") ?? ""));
  if (!cat) return; // href inconnu : on n'écrit pas de cookie orphelin

  // On reconstruit l'état complet depuis le catalogue plutôt que depuis le
  // formulaire : une case décochée n'est PAS envoyée, donc lire le FormData seul
  // ne permettrait pas de distinguer « éteint » de « absent du formulaire ».
  const choix = Object.fromEntries(cat.blocs.map((b) => [b.id, fd.get(`bloc:${b.id}`) === "1"]));

  (await cookies()).set(cat.cookie, serialiserChoix(cat, choix), {
    path: "/",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 365,
  });
  // "layout" et pas la page seule : la roue est rendue par le layout, donc son
  // état affiché vient de là. Revalider la page seule laisserait la sidebar sur
  // l'ancien choix jusqu'au prochain rechargement complet.
  revalidatePath(cat.href, "layout");
}
