"use server";
// Server Actions /admin/privacy (Lot 5b, DSAR) — effacement des données d'un
// visiteur (droit à l'effacement RGPD), admin only, tracé dans audit_log.
// L'effacement est irréversible : on exige la re-saisie exacte de l'identifiant.
//
// Un REFUS (identifiant qui n'est qu'une ancienne empreinte de terminal) est
// tracé comme le reste : une demande d'effacement à laquelle on n'a pas donné
// suite doit laisser une trace, sinon on ne peut pas prouver qu'on a répondu.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { DsarRefus } from "@/lib/dsar";
import { dsarErase } from "@/lib/queries-dsar";

async function audit(adminEmail: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
    adminEmail,
    action,
    detail,
  ]);
}

/** Effacement DSAR : supprime toutes les données du visiteur (transaction). */
export async function eraseUserAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const app = String(fd.get("app") ?? "all").trim() || "all";
  const visitorId = String(fd.get("user") ?? "").trim();
  const confirm = String(fd.get("confirm") ?? "").trim();
  const back = `/admin/privacy?app=${encodeURIComponent(app)}&user=${encodeURIComponent(visitorId)}`;

  if (!visitorId) redirect("/admin/privacy?error=empty");
  // garde-fou anti-fausse-manœuvre : re-saisie exacte de l'identifiant exigée
  if (confirm !== visitorId) redirect(`${back}&error=confirm`);

  let deleted;
  try {
    deleted = await dsarErase(app, visitorId);
  } catch (e) {
    if (!(e instanceof DsarRefus)) throw e;
    await audit(admin.email, "dsar_erase_refuse", `user=${visitorId} app=${app} motif=${e.verdict}`);
    redirect(`${back}&error=${e.verdict}`);
  }
  const total = deleted.reduce((acc, d) => acc + d.deleted, 0);
  await audit(
    admin.email,
    "dsar_erase",
    `user=${visitorId} app=${app} rows=${total} (${deleted.map((d) => `${d.table}:${d.deleted}`).join(",")})`,
  );
  revalidatePath("/admin/privacy");
  redirect(`/admin/privacy?app=${encodeURIComponent(app)}&erased=${total}`);
}
