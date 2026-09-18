"use server";
// Server Actions /admin/ticket-integrations (P8.6) — configurer un connecteur de
// tickets, l'activer, marquer sa recette jouée, le sortir de `degraded`.
//
// AUCUN SECRET NE TRANSITE PAR CE FORMULAIRE. Le champ attendu est une
// RÉFÉRENCE : `env:NOM_DE_VARIABLE` (le gestionnaire de secrets du runtime) ou
// `enc:v1:…` (chiffré par une clé serveur séparée). Un jeton collé là est refusé
// avant toute écriture, et la contrainte de base le refuserait de toute façon.
//
// LE DÉPÔT CIBLE EST SAISI, JAMAIS DÉDUIT. Rien ne lit le remote git de MIP :
// ouvrir les tickets d'un client dans le dépôt du produit serait une fuite, et
// un défaut « pratique » est exactement ainsi qu'elle arriverait.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  createTicketIntegration,
  parseIntegrationRequest,
  patchTicketIntegration,
} from "@/lib/queries-ticket-integrations";

const PAGE = "/admin/ticket-integrations";

function retour(message: string): never {
  redirect(`${PAGE}?erreur=${encodeURIComponent(message)}`);
}

export async function creerIntegrationAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const mapping: Record<string, string | null> = {
    closed: String(fd.get("mapClosed") ?? "") || null,
    reopened: String(fd.get("mapReopened") ?? "") || null,
  };
  const demande = parseIntegrationRequest({
    app: String(fd.get("app") ?? "").trim(),
    provider: String(fd.get("provider") ?? "github").trim(),
    target: String(fd.get("target") ?? "").trim(),
    credentialRef: String(fd.get("credentialRef") ?? "").trim(),
    webhookSecretRef: String(fd.get("webhookSecretRef") ?? "").trim() || null,
    statusMapping: mapping,
  });
  if (!demande.ok) retour(demande.error);
  try {
    const cree = await createTicketIntegration(demande.value, admin.email);
    if (!cree) retour(`application inconnue : ${demande.value.app}`);
  } catch (err) {
    if (String((err as { code?: string })?.code) === "23505") {
      retour("cette cible est déjà configurée pour cette application");
    }
    throw err;
  }
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function majIntegrationAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const champ = String(fd.get("champ") ?? "");
  const patch =
    champ === "enabled"
      ? { enabled: String(fd.get("valeur")) === "1" }
      : champ === "verified"
        ? { verified: String(fd.get("valeur")) === "1" }
        : champ === "state"
          ? ({ state: "active" } as const)
          : null;
  if (!patch) retour("action inconnue");
  // Le périmètre est revérifié APRÈS résolution de la ressource, dans la
  // requête : `admin.apps` null vaut toutes les apps, une liste vide aucune.
  const maj = await patchTicketIntegration(id, patch, admin.email, admin.apps ?? null);
  if (!maj) retour("intégration introuvable");
  revalidatePath(PAGE);
  redirect(PAGE);
}
