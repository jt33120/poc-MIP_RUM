"use server";
// Server Actions /admin/uptime — gestion des checks de monitoring synthétique,
// admin only, tracé dans audit_log. Aucun secret (juste une URL à surveiller).
//
// L'URL EST JUGÉE À L'ÉCRITURE (P1). Une sonde est une requête que le scheduler
// émet depuis le réseau privé Railway : une IP littérale, un nom interne
// (`*.railway.internal`, `localhost`) ou un nom sans domaine sont refusés ici,
// avec leur motif, par le contrôle sans réseau de `safe-fetch`. Ce contrôle ne
// fait pas foi : ce que le DNS répondra au moment de la sonde, seul `safeFetch`
// le juge, à chaque tick. Le refus passe par une redirection et un CODE, relu
// par la page — pas par une exception, que Next remplacerait en production par
// l'écran d'erreur générique.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifierUrlSortante } from "@mip/backend/lib/net/safe-fetch.mjs";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import {
  createUptimeCheck,
  deleteUptimeCheck,
  toggleUptimeCheck,
} from "@/lib/queries-uptime";

async function audit(email: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [email, action, detail]);
}

export async function createUptimeCheckAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const app = String(fd.get("app") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  const url = String(fd.get("url") ?? "").trim();
  const expect = Number(fd.get("expect_status") ?? 200) || 200;
  if (!app || !name || !url) redirect("/admin/uptime?error=1");
  const verdict = verifierUrlSortante(url);
  if (!verdict.ok) redirect(`/admin/uptime?url_refusee=${verdict.code}`);
  await createUptimeCheck(app, name, url, expect);
  await audit(admin.email, "uptime_check_create", `${name} ${url} -> ${app}`);
  revalidatePath("/admin/uptime");
  redirect("/admin/uptime");
}

export async function toggleUptimeCheckAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(fd.get("id"));
  const enabled = fd.get("enabled") === "1";
  if (!Number.isFinite(id)) redirect("/admin/uptime");
  await toggleUptimeCheck(id, enabled);
  await audit(admin.email, "uptime_check_toggle", `id=${id} enabled=${enabled}`);
  revalidatePath("/admin/uptime");
  redirect("/admin/uptime");
}

export async function deleteUptimeCheckAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(fd.get("id"));
  if (!Number.isFinite(id)) redirect("/admin/uptime");
  await deleteUptimeCheck(id);
  await audit(admin.email, "uptime_check_delete", `id=${id}`);
  revalidatePath("/admin/uptime");
  redirect("/admin/uptime");
}
