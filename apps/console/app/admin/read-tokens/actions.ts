"use server";
// Server Actions /admin/read-tokens (livrable UTI) — génère / révoque les tokens
// de lecture. C9 — les COMMANDES `creerJetonLecture` et `revoquerJetonLecture`
// (`lib/commandes/raccordements.ts`) : l'administrateur de l'application du jeton,
// audité ; le jeton en clair rendu UNE fois par la commande (seul le hash est en
// base), rendu au formulaire (`useActionState`, C9c) qui l'affiche une fois.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";
import type { SecretRemis } from "@/lib/secret-remis";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

export async function createReadTokenAction(_precedent: SecretRemis, fd: FormData): Promise<SecretRemis> {
  const app = champ(fd, "app");
  if (!app) redirect("/admin/read-tokens?error=app");
  const r = await executerCommande("creerJetonLecture", { app, corps: { label: champ(fd, "label") } });
  if (!r.ok) {
    apresRefus(r);
    redirect("/admin/read-tokens?error=app");
  }
  revalidatePath("/admin/read-tokens");
  return { nom: "jeton-lecture", valeur: r.data.jeton, pour: r.data.app };
}

export async function revokeReadTokenAction(fd: FormData): Promise<void> {
  const r = await executerCommande("revoquerJetonLecture", { app: champ(fd, "app") || null, chemin: { id: champ(fd, "id") } });
  if (!r.ok) apresRefus(r);
  revalidatePath("/admin/read-tokens");
  redirect("/admin/read-tokens");
}
