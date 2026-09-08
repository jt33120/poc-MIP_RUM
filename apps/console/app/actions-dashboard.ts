"use server";
// Réglage des blocs de la Vue d'ensemble — écrit le cookie lu par la page.
// Aucune donnée sensible : une liste d'identifiants d'affichage, donc pas de
// httpOnly (aucun intérêt) mais un SameSite strict comme le reste du site.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { BLOCS, COOKIE_BLOCS, serialiserChoix, type BlocId } from "@/lib/dashboard-blocs";

export async function reglerBlocsAction(fd: FormData): Promise<void> {
  // On reconstruit l'état complet depuis le catalogue plutôt que depuis le
  // formulaire : une case décochée n'est PAS envoyée, donc lire le FormData seul
  // ne permettrait pas de distinguer « éteint » de « absent du formulaire ».
  const choix = Object.fromEntries(
    BLOCS.map((b) => [b.id, fd.get(`bloc:${b.id}`) === "1"]),
  ) as Record<BlocId, boolean>;

  (await cookies()).set(COOKIE_BLOCS, serialiserChoix(choix), {
    path: "/",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/");
}
