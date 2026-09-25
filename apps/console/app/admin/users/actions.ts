"use server";
// Server Actions /admin/users (B3) — création / activation / réinitialisation.
// C9 — chaque écriture est une COMMANDE (`lib/commandes/comptes.ts`) : réservée à
// l'administrateur de la PLATEFORME, auditée, le mot de passe généré et haché par
// elle, rendu UNE fois par sa décision. Ici : le formulaire, et l'affichage unique
// du mot de passe (stash mémoire, jamais en clair dans l'URL ni en base).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { stashSecret } from "@/lib/auth";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

export async function createUserAction(fd: FormData): Promise<void> {
  const r = await executerCommande("creerCompte", {
    corps: { email: champ(fd, "email"), role: champ(fd, "role") === "admin" ? "admin" : "viewer", apps: champ(fd, "apps") },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect("/admin/users?error=email");
  }
  if (r.data.etat === "email_invalide") redirect("/admin/users?error=email");
  if (r.data.etat === "existe") redirect("/admin/users?error=exists");
  revalidatePath("/admin/users");
  if (r.data.etat === "cree") redirect(`/admin/users?pwt=${stashSecret(r.data.motDePasse)}&pwe=${encodeURIComponent(r.data.email)}`);
}

/** Le formulaire porte l'état VOULU (`active`), pas un « inverser ». */
export async function toggleUserAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerCompte", { corps: { email: champ(fd, "email"), active: champ(fd, "active") === "true" } });
  if (!r.ok) apresRefus(r);
  if (r.ok && r.data.etat === "soi_meme") redirect("/admin/users?error=self"); // anti-verrouillage
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function resetPasswordAction(fd: FormData): Promise<void> {
  const r = await executerCommande("reinitialiserMotDePasse", { corps: { email: champ(fd, "email") } });
  if (!r.ok) apresRefus(r);
  if (!r.ok || r.data.etat !== "ok") redirect("/admin/users?error=unknown");
  revalidatePath("/admin/users");
  redirect(`/admin/users?pwt=${stashSecret(r.data.motDePasse)}&pwe=${encodeURIComponent(r.data.email)}`);
}
