"use server";
// Server Actions de l'Explorer (P6.5) : enregistrer une analyse comme VUE.
//
// Écriture de session, jamais un jeton : une server action n'est atteignable
// qu'avec le cookie de la console. La propriété et le périmètre sont revérifiés
// par `lib/queries-saved-views.ts` après résolution de la ressource — le
// formulaire ne décide de rien.
//
// L'AST N'EST PAS RECOMPOSÉ ICI. Le formulaire transporte l'AST canonique déjà
// produit par la requête exécutée ; il retraverse la validation du registre, donc
// le même refus que `POST /api/v1/explorer/views`.
import { redirect } from "next/navigation";
import { revalidatePath } from "@/lib/next-cache";
import { getUser } from "@/lib/auth";
import { parseSavedViewName, parseSavedViewQuery } from "@/lib/saved-views";
import {
  createSavedView,
  deleteSavedView,
  savedViewReader,
  updateSavedView,
} from "@/lib/queries-saved-views";
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
  const user = await getUser();
  if (!user) return;
  const nom = parseSavedViewName(fd.get("name"));
  if (!nom.ok) redirect(`/explorer?${contexte(fd)}`);
  let ast: unknown;
  try {
    ast = JSON.parse(String(fd.get("query") ?? ""));
  } catch {
    redirect(`/explorer?${contexte(fd)}`);
  }
  const requete = parseSavedViewQuery(ast, { principal: user, nowMs: Date.now() });
  if (!requete.ok) redirect(`/explorer?${contexte(fd)}`);

  const reader = await savedViewReader(user);
  const result = await createSavedView(reader, {
    app: requete.value.app,
    name: nom.value,
    query: requete.value.query,
  });
  if (result.kind === "limit") redirect(retourVues("plafond"));
  if (result.kind !== "ok") redirect(retourVues("refus"));
  revalidatePath("/explorer/views");
  redirect(retourVues());
}

/** Renomme une vue. Le propriétaire seul, et seulement sur la révision qu'il a lue. */
export async function renameViewAction(fd: FormData): Promise<void> {
  const user = await getUser();
  if (!user) return;
  const id = String(fd.get("id") ?? "");
  const nom = parseSavedViewName(fd.get("name"));
  if (!nom.ok) redirect(retourVues("refus"));
  const reader = await savedViewReader(user);
  const result = await updateSavedView(reader, id, {
    name: nom.value,
    query: null,
    app: null,
    expectedRevision: String(fd.get("revision") ?? ""),
  });
  if (result.kind === "conflict") redirect(retourVues("conflit"));
  if (result.kind !== "ok") redirect(retourVues("refus"));
  revalidatePath("/explorer/views");
}

export async function deleteViewAction(fd: FormData): Promise<void> {
  const user = await getUser();
  if (!user) return;
  const reader = await savedViewReader(user);
  const result = await deleteSavedView(reader, String(fd.get("id") ?? ""));
  if (result.kind !== "ok") redirect(retourVues("refus"));
  revalidatePath("/explorer/views");
}
