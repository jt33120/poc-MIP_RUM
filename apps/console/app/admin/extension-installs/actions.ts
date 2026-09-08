"use server";
// Server Actions /admin/extension-installs (Ext-D) — admin only, tracé.
// Une seule action : retirer un poste de l'inventaire. Rien ici ne pilote
// l'extension à distance (pas de désinstallation, pas de kill-switch par poste) :
// le seul levier d'arrêt de la collecte reste le registre de domaines, côté
// serveur, et il vaut pour tout le parc à la fois.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { forgetInstall } from "@/lib/queries-extension-installs";

export async function forgetInstallAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(fd.get("install_id") ?? "").trim();
  if (!id) return;
  await forgetInstall(id);
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
    admin.email,
    "extension_install_forget",
    id,
  ]);
  revalidatePath("/admin/extension-installs");
}
