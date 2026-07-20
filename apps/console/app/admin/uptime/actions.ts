"use server";
// Server Actions /admin/uptime — gestion des checks de monitoring synthétique,
// admin only, tracé dans audit_log. Aucun secret (juste une URL à surveiller).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
  if (!app || !name || !/^https?:\/\//i.test(url)) redirect("/admin/uptime?error=1");
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
