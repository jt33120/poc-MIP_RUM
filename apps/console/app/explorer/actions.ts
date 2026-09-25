"use server";
// Server Actions de l'Explorer (P6.5) : enregistrer une analyse comme VUE.
//
// Écriture de session, jamais un jeton : une server action n'est atteignable
// qu'avec le cookie de la console. La propriété et le périmètre sont revérifiés
// par la commande (`lib/commandes/vues.ts`, C6) après résolution de la ressource —
// le formulaire ne décide de rien.
//
// L'AST N'EST PAS RECOMPOSÉ ICI. Le formulaire transporte l'AST canonique déjà
// produit par la requête exécutée ; il retraverse la validation du registre, donc
// le même refus que `POST /api/v1/explorer/views`.
import { redirect } from "next/navigation";
import { revalidatePath } from "@/lib/next-cache";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";
import { CONTRACT_PARAMS } from "@/lib/query-contract";

/** Contexte de filtres reporté par le formulaire, limité aux paramètres du contrat. */
function contexte(fd: FormData): string {
  const entrant = new URLSearchParams(String(fd.get("ctx") ?? ""));
  const sortie = new URLSearchParams();
  for (const nom of CONTRACT_PARAMS) {
    const valeur = entrant.get(nom);
    if (valeur !== null) sortie.set(nom, valeur);
  }
  return sortie.toString();
}

function retourVues(etat?: "conflit" | "refus" | "plafond"): string {
  return etat ? `/explorer/views?${etat}=1` : "/explorer/views";
}

/** Enregistre la requête exécutée comme vue personnelle, puis ouvre la liste. */
export async function saveViewAction(fd: FormData): Promise<void> {
  let ast: unknown;
  try {
    ast = JSON.parse(String(fd.get("query") ?? ""));
  } catch {
    redirect(`/explorer?${contexte(fd)}`);
  }
  const r = await executerCommande("creerVue", { corps: { name: fd.get("name"), query: ast } });
  if (!r.ok) {
    apresRefus(r);
    redirect(retourVues("refus"));
  }
  // Nom ou AST refusés par l'analyseur des vues : retour à l'analyse, rien d'écrit.
  if (r.data.kind === "invalid") redirect(`/explorer?${contexte(fd)}`);
  if (r.data.kind === "limit") redirect(retourVues("plafond"));
  if (r.data.kind !== "ok") redirect(retourVues("refus"));
  revalidatePath("/explorer/views");
  redirect(retourVues());
}

/** Renomme une vue. Le propriétaire seul, et seulement sur la révision qu'il a lue. */
export async function renameViewAction(fd: FormData): Promise<void> {
  const r = await executerCommande("modifierVue", {
    chemin: { id: String(fd.get("id") ?? "") },
    corps: { name: fd.get("name"), expectedRevision: String(fd.get("revision") ?? "") },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect(retourVues("refus"));
  }
  if (r.data.kind === "conflict") redirect(retourVues("conflit"));
  if (r.data.kind !== "ok") redirect(retourVues("refus"));
  revalidatePath("/explorer/views");
}

export async function deleteViewAction(fd: FormData): Promise<void> {
  const r = await executerCommande("supprimerVue", { chemin: { id: String(fd.get("id") ?? "") } });
  if (!r.ok) {
    apresRefus(r);
    redirect(retourVues("refus"));
  }
  if (r.data.kind !== "ok") redirect(retourVues("refus"));
  revalidatePath("/explorer/views");
}
