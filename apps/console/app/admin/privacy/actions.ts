"use server";
// Server Actions /admin/privacy (Lot 5b, DSAR) — effacement des données d'un
// utilisateur (droit à l'effacement RGPD), admin only, tracé dans audit_log.
// L'effacement est irréversible : on exige la re-saisie exacte du user_hash.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { dsarErase } from "@/lib/queries-dsar";

async function audit(adminEmail: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
    adminEmail,
    action,
    detail,
  ]);
}

/** Effacement DSAR : supprime toutes les données de l'utilisateur (transaction). */
export async function eraseUserAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const app = String(fd.get("app") ?? "all").trim() || "all";
  const userHash = String(fd.get("user") ?? "").trim();
  const confirm = String(fd.get("confirm") ?? "").trim();
  const back = `/admin/privacy?app=${encodeURIComponent(app)}&user=${encodeURIComponent(userHash)}`;

  if (!userHash) redirect("/admin/privacy?error=empty");
  // garde-fou anti-fausse-manœuvre : re-saisie exacte du hash exigée
  if (confirm !== userHash) redirect(`${back}&error=confirm`);

  const deleted = await dsarErase(app, userHash);
  const total = deleted.reduce((acc, d) => acc + d.deleted, 0);
  await audit(
    admin.email,
    "dsar_erase",
    `user=${userHash} app=${app} rows=${total} (${deleted.map((d) => `${d.table}:${d.deleted}`).join(",")})`,
  );
  revalidatePath("/admin/privacy");
  redirect(`/admin/privacy?app=${encodeURIComponent(app)}&erased=${total}`);
}
