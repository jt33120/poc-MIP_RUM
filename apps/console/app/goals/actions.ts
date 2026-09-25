"use server";
// Server Actions /goals (Lot 8b) — gestion des objectifs, par l'administrateur de
// l'application, tracée dans audit_log.
//
// C6 — l'écriture est la COMMANDE (`lib/commandes/objectifs.ts`), appelée par sa
// clé : ici, seulement la lecture du formulaire et la suite de la décision. Les
// gardes (session, rôle, application du périmètre) et l'audit sont ceux de la
// commande, les mêmes que console-api servira.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

export async function createGoalAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app");
  const r = await executerCommande("creerObjectif", {
    app,
    corps: { name: champ(fd, "name"), kind: champ(fd, "kind"), pattern: champ(fd, "pattern"), match_type: champ(fd, "match_type") || "exact" },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect("/goals?error=champs");
  }
  revalidatePath("/goals");
  redirect(`/goals?app=${encodeURIComponent(app)}`);
}

/** Active ou suspend : le formulaire porte l'état VOULU, pas un « inverser ». */
export async function toggleGoalAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerObjectif", {
    app: champ(fd, "app"),
    chemin: { id: champ(fd, "id") },
    corps: { active: champ(fd, "active") === "true" },
  });
  if (!r.ok) apresRefus(r);
  revalidatePath("/goals");
  redirect("/goals");
}

export async function deleteGoalAction(fd: FormData): Promise<void> {
  const r = await executerCommande("supprimerObjectif", { app: champ(fd, "app"), chemin: { id: champ(fd, "id") } });
  if (!r.ok) apresRefus(r);
  revalidatePath("/goals");
  redirect("/goals");
}
