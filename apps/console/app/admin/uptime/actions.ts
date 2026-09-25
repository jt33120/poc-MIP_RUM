"use server";
// Server Actions /admin/uptime — gestion des checks de monitoring synthétique.
// C8 — chaque écriture est une COMMANDE (`lib/commandes/uptime.ts`) : l'administrateur
// de l'application du check, l'URL jugée à l'écriture (refus rendu par son CODE,
// relu par la page), l'écriture et sa ligne d'audit dans une transaction, et la
// ligne filtrée par son application (activer ou supprimer ne vise plus un
// identifiant seul).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

export async function createUptimeCheckAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app");
  const name = champ(fd, "name");
  const url = champ(fd, "url");
  if (!app || !name || !url) redirect("/admin/uptime?error=1");
  const statut = champ(fd, "expect_status");
  const r = await executerCommande("creerSonde", { app, corps: { name, url, ...(statut ? { expect_status: statut } : {}) } });
  if (!r.ok) {
    apresRefus(r);
    redirect("/admin/uptime?error=1");
  }
  if (r.data.etat === "url_refusee") redirect(`/admin/uptime?url_refusee=${r.data.code}`);
  revalidatePath("/admin/uptime");
  redirect("/admin/uptime");
}

export async function toggleUptimeCheckAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerSonde", {
    app: champ(fd, "app") || null,
    chemin: { id: champ(fd, "id") },
    corps: { enabled: fd.get("enabled") === "1" },
  });
  if (!r.ok) apresRefus(r);
  revalidatePath("/admin/uptime");
  redirect("/admin/uptime");
}

export async function deleteUptimeCheckAction(fd: FormData): Promise<void> {
  const r = await executerCommande("supprimerSonde", { app: champ(fd, "app") || null, chemin: { id: champ(fd, "id") } });
  if (!r.ok) apresRefus(r);
  revalidatePath("/admin/uptime");
  redirect("/admin/uptime");
}
