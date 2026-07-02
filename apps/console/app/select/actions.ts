"use server";
// Pose le cookie de projet courant puis entre dans la console sur ce projet.
// Le projet est aussi propagé dans l'URL (?app) pour que la première page rende
// le bon scope sans dépendre d'un aller-retour middleware.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { PROJECT_COOKIE, PROJECT_COOKIE_MAX_AGE, projectsForUser } from "@/lib/project";

export async function selectProjectAction(fd: FormData): Promise<void> {
  const appId = String(fd.get("app") ?? "");
  const user = await getUser();
  if (!user) redirect("/login");
  // Anti-forgery : on n'accepte qu'un projet réellement visible par l'utilisateur.
  const projects = await projectsForUser(user!);
  if (!projects.some((p) => p.app_id === appId)) redirect("/select");

  (await cookies()).set(PROJECT_COOKIE, appId, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PROJECT_COOKIE_MAX_AGE,
  });
  redirect(`/?app=${encodeURIComponent(appId)}`);
}
