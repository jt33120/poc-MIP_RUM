"use server";
// Server Actions /admin/customers (v0.5) — création d'app cliente, rotation de
// clé, activation, origines CORS. C9 — chaque écriture est une COMMANDE
// (`lib/commandes/applications.ts`) : créer une application revient à
// l'administrateur de la PLATEFORME ; la gérer, à l'administrateur de CETTE
// application. La clé d'ingestion est générée, hachée (sha256) et rendue UNE fois
// par la commande, puis rendue au formulaire (`useActionState`, C9c), qui l'affiche
// sur la fiche de l'application.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";
import { cleDe, type SecretRemis } from "@/lib/secret-remis";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

export async function createCustomerAction(_precedent: SecretRemis, fd: FormData): Promise<SecretRemis> {
  const clientId = champ(fd, "client_id");
  const notes = champ(fd, "notes");
  const r = await executerCommande("creerApplication", {
    corps: {
      app_id: champ(fd, "app_id"),
      name: champ(fd, "name"),
      ...(clientId ? { client_id: clientId } : {}),
      ...(notes ? { notes } : {}),
      origins: String(fd.get("origins") ?? ""),
    },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect("/admin/customers?error=app_id");
  }
  const d = r.data;
  if (d.etat === "refus") redirect(`/admin/customers?error=${d.champ}${"detail" in d && d.detail ? `&detail=${encodeURIComponent(d.detail)}` : ""}`);
  if (d.etat === "existe") redirect("/admin/customers?error=exists");
  revalidatePath("/admin/customers");
  return d.etat === "cree" ? { nom: cleDe(d.app), valeur: d.cle, pour: d.app, aller: `/admin/customers/${d.app}` } : null;
}

export async function rotateKeyAction(_precedent: SecretRemis, fd: FormData): Promise<SecretRemis> {
  const appId = champ(fd, "app_id");
  const r = await executerCommande("renouvelerCle", { app: appId });
  if (!r.ok) apresRefus(r);
  if (!r.ok || r.data.etat !== "ok") redirect("/admin/customers?error=unknown");
  revalidatePath(`/admin/customers/${appId}`);
  return { nom: cleDe(appId), valeur: r.data.cle, pour: appId };
}

/** Le formulaire porte l'état VOULU (`active`), pas un « inverser ». */
export async function toggleAppAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerApplication", { app: champ(fd, "app_id"), corps: { active: champ(fd, "active") === "true" } });
  if (!r.ok) apresRefus(r);
  revalidatePath("/admin/customers");
  redirect("/admin/customers");
}

export async function updateOriginsAction(fd: FormData): Promise<void> {
  const appId = champ(fd, "app_id");
  const r = await executerCommande("majOrigines", { app: appId, corps: { origins: String(fd.get("origins") ?? "") } });
  if (!r.ok) apresRefus(r);
  if (!r.ok || r.data.etat === "refus") redirect(`/admin/customers/${appId}?error=origin`);
  revalidatePath(`/admin/customers/${appId}`);
  redirect(`/admin/customers/${appId}`);
}
