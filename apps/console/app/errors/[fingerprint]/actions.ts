"use server";
// Server action — triage d'un groupe d'erreurs (résolu / ignoré / rouvert).
// Réservée à une session d'ADMINISTRATION hors démo, dans le périmètre de l'app du
// groupe ; tracée dans audit_log. Elle était ouverte à tout connecté (choix P1),
// alors que depuis F20 l'écran ne rend plus ses boutons à un viewer ni à la démo
// (V9) : la protection n'était plus que visuelle, et une session de démonstration
// — publique — pouvait écrire par un POST direct. Même prédicat que la page.
import { revalidatePath } from "@/lib/next-cache";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { authorizedAppsOf } from "@/lib/query-contract";
import { ERROR_STATUSES, setErrorStatus, type ErrorStatus } from "@/lib/queries-v2";

export async function setErrorStatusAction(fd: FormData): Promise<void> {
  const user = await getUser();
  if (!user || user.role !== "admin" || user.demo) return;

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
