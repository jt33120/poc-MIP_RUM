"use server";
// Server Actions /admin/read-tokens (livrable UTI) — génère / révoque les tokens
// de lecture, admin only, tracé dans audit_log. Le token en clair n'est affiché
// qu'UNE fois (stash mémoire), jamais stocké ni relu (seul le hash est en base).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, stashSecret } from "@/lib/auth";
import { q } from "@/lib/db";
import { generateToken } from "@/lib/read-tokens";
import { createReadToken, revokeReadToken } from "@/lib/queries-read-tokens";

async function audit(email: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [email, action, detail]);
}

export async function createReadTokenAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const app = String(fd.get("app") ?? "").trim();
  const label = String(fd.get("label") ?? "").trim();
  if (!app) redirect("/admin/read-tokens?error=app");
  const token = generateToken();
  await createReadToken(app, label, token);
  await audit(admin.email, "read_token_create", `${app} "${label || "-"}"`);
  revalidatePath("/admin/read-tokens");
  redirect(`/admin/read-tokens?tkt=${stashSecret(token)}&tka=${encodeURIComponent(app)}`);
}

export async function revokeReadTokenAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(fd.get("id"));
  if (!Number.isFinite(id)) redirect("/admin/read-tokens");
  await revokeReadToken(id);
  await audit(admin.email, "read_token_revoke", `id=${id}`);
  revalidatePath("/admin/read-tokens");
  redirect("/admin/read-tokens");
}
