"use server";
// Server Actions /admin/extension-installs (Ext-D). Une seule : retirer un poste de
// l'inventaire — C9, la COMMANDE `oublierPoste` (`lib/commandes/raccordements.ts`),
// réservée à l'administrateur de la plateforme (un poste observe plusieurs
// applications), auditée. Rien ici ne pilote l'extension à distance : le seul
// levier d'arrêt de la collecte reste le registre de domaines.
import { revalidatePath } from "next/cache";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";

export async function forgetInstallAction(fd: FormData): Promise<void> {
  const id = String(fd.get("install_id") ?? "").trim();
  if (!id) return;
  const r = await executerCommande("oublierPoste", { chemin: { installId: id } });
  if (!r.ok) apresRefus(r);
  revalidatePath("/admin/extension-installs");
}
