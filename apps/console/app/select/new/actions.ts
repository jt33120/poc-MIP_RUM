"use server";
// Ajout self-service d'un site à monitorer depuis /select (le « + »). C9 — la
// commande `creerSite` (`lib/commandes/applications.ts`) : la même création que
// /admin/customers — application, clé hachée, et en mode extension le domaine —
// avec un formulaire minimal (nom + URL ; l'identifiant dérivé du nom, l'origine
// CORS de l'URL), en une transaction. Administrateur de la plateforme, audité. Ici :
// le formulaire ; la clé est rendue au formulaire (`useActionState`, C9c), qui la
// remet à l'étape 2 (bandeau, bookmarklet, commande de l'agent).
import { redirect } from "next/navigation";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";
import { cleDe, type SecretRemis } from "@/lib/secret-remis";

export async function createSiteAction(_precedent: SecretRemis, fd: FormData): Promise<SecretRemis> {
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
  return d.etat === "cree"
    ? { nom: cleDe(d.app), valeur: d.cle, pour: d.app, aller: `/select/new?app=${encodeURIComponent(d.app)}&mode=${d.mode}` }
    : null;
}
