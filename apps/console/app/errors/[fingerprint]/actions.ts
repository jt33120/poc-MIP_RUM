"use server";
// Server action — triage d'un groupe d'erreurs (résolu / ignoré / rouvert).
// Accessible à tout utilisateur connecté ayant accès à l'app du groupe (pas
// réservé admin) ; tracé dans audit_log.
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { authorizedAppsOf } from "@/lib/query-contract";
import { ERROR_STATUSES, setErrorStatus, type ErrorStatus } from "@/lib/queries-v2";

export async function setErrorStatusAction(fd: FormData): Promise<void> {
  const user = await getUser();
  if (!user) return;

  const appId = String(fd.get("app_id") ?? "").trim();
  const fingerprint = String(fd.get("fingerprint") ?? "").trim();
  const status = String(fd.get("status") ?? "") as ErrorStatus;
  if (!appId || !fingerprint || !ERROR_STATUSES.includes(status)) return;

  // scoping : un utilisateur restreint ne peut trier que ses apps (liste vide = aucune)
  const authorized = authorizedAppsOf(user);
  if (authorized !== null && !authorized.includes(appId)) return;

  await setErrorStatus(appId, fingerprint, status, user.email);
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
    user.email,
    "error_status_set",
    `${appId}/${fingerprint} -> ${status}`,
  ]);
  revalidatePath(`/errors/${fingerprint}`);
  revalidatePath("/errors");
}
