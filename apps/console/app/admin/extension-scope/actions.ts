"use server";
// Server Actions /admin/extension-scope (Ext-C) — enregistre/active un domaine
// pour l'extension navigateur. C9 — les COMMANDES `creerDomaineExtension` et
// `activerDomaineExtension` (`lib/commandes/raccordements.ts`) : l'administrateur
// de l'application du domaine, audité. Aucun secret ici : un mapping
// domaine → application, et l'origine HTTPS du domaine autorisée à poster (CORS).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

export async function createExtensionScopeAction(fd: FormData): Promise<void> {
  const domain = champ(fd, "domain");
  const app = champ(fd, "app");
  if (!domain || !app) redirect("/admin/extension-scope?error=1");
  const r = await executerCommande("creerDomaineExtension", { app, corps: { domain } });
  if (!r.ok) apresRefus(r);
  if (!r.ok || r.data.etat !== "ok") redirect("/admin/extension-scope?error=1");
  revalidatePath("/admin/extension-scope");
  redirect("/admin/extension-scope");
}

export async function toggleExtensionScopeAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerDomaineExtension", {
    app: champ(fd, "app") || null,
    chemin: { id: champ(fd, "id") },
    corps: { active: fd.get("active") === "1" },
  });
  if (!r.ok) apresRefus(r);
  revalidatePath("/admin/extension-scope");
  redirect("/admin/extension-scope");
}
