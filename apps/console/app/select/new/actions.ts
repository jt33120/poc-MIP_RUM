"use server";
// Ajout self-service d'un site à monitorer depuis /select (le « + »). C9 — la
// commande `creerSite` (`lib/commandes/applications.ts`) : la même création que
// /admin/customers — application, clé hachée, et en mode extension le domaine —
// avec un formulaire minimal (nom + URL ; l'identifiant dérivé du nom, l'origine
// CORS de l'URL), en une transaction. Administrateur de la plateforme, audité. Ici :
// le formulaire, et l'affichage unique de la clé (stash mémoire).
import { redirect } from "next/navigation";
import { stashSecret } from "@/lib/auth";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";

export async function createSiteAction(fd: FormData): Promise<void> {
  const rawId = String(fd.get("app_id") ?? "").trim();
  // Mode de collecte choisi à l'étape 1 : 'sdk' (injection JS) | 'extension'.
  const mode = String(fd.get("mode") ?? "sdk") === "extension" ? "extension" : "sdk";
  const r = await executerCommande("creerSite", {
    corps: { name: String(fd.get("name") ?? ""), url: String(fd.get("url") ?? ""), ...(rawId ? { app_id: rawId } : {}), mode },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect("/select/new?error=name");
  }
  const d = r.data;
  if (d.etat === "refus") redirect(`/select/new?error=${d.champ}`);
  if (d.etat === "existe") redirect("/select/new?error=exists");
  if (d.etat === "cree") redirect(`/select/new?app=${encodeURIComponent(d.app)}&kt=${stashSecret(d.cle)}&mode=${d.mode}`);
}
