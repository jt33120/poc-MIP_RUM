"use server";
// Server Actions /admin/ticket-integrations (P8.6) — configurer un connecteur de
// tickets, l'activer, marquer sa recette jouée, le sortir de `degraded`. C9 — les
// COMMANDES `creerIntegration` et `majIntegration` (`lib/commandes/raccordements.ts`) :
// l'administrateur de l'application du connecteur, audité dans la transaction.
//
// AUCUN SECRET NE TRANSITE PAR CE FORMULAIRE. Le champ attendu est une
// RÉFÉRENCE : `env:TICKET_NOM` ou `enc:v1:…`. Un jeton collé là est refusé avant
// toute écriture. LE DÉPÔT CIBLE EST SAISI, JAMAIS DÉDUIT.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";

const PAGE = "/admin/ticket-integrations";
const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

function retour(message: string): never {
  redirect(`${PAGE}?erreur=${encodeURIComponent(message)}`);
}

export async function creerIntegrationAction(fd: FormData): Promise<void> {
  const webhook = champ(fd, "webhookSecretRef");
  const fermee = champ(fd, "mapClosed");
  const rouverte = champ(fd, "mapReopened");
  const r = await executerCommande("creerIntegration", {
    app: champ(fd, "app"),
    corps: {
      provider: champ(fd, "provider") || "github",
      target: champ(fd, "target"),
      credentialRef: champ(fd, "credentialRef"),
      ...(webhook ? { webhookSecretRef: webhook } : {}),
      ...(fermee ? { mapClosed: fermee } : {}),
      ...(rouverte ? { mapReopened: rouverte } : {}),
    },
  });
  if (!r.ok) {
    apresRefus(r);
    retour(r.code === "hors_perimetre" ? "application hors de votre périmètre" : r.message);
  }
  if (r.data.etat === "refus") retour(r.data.message);
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function majIntegrationAction(fd: FormData): Promise<void> {
  const champDuPatch = champ(fd, "champ");
  const r = await executerCommande("majIntegration", {
    app: champ(fd, "app") || null,
    chemin: { id: champ(fd, "id") },
    corps: { champ: champDuPatch, valeur: champ(fd, "valeur") === "1" || champDuPatch === "state" },
  });
  if (!r.ok) {
    apresRefus(r);
    retour(r.code === "entree_invalide" ? "action inconnue" : r.message);
  }
  if (r.data.etat !== "ok") retour("intégration introuvable");
  revalidatePath(PAGE);
  redirect(PAGE);
}
