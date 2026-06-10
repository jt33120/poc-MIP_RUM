"use server";
// Server Actions /admin/users (B3) — création / activation / reset, admin only,
// chaque action écrite dans audit_log. Mots de passe générés côté serveur et
// affichés UNE fois via le stash mémoire (jamais en clair dans l'URL ni en base).
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, stashSecret } from "@/lib/auth";
import { q } from "@/lib/db";

/** 18 caractères URL-safe (~107 bits d'entropie). */
function genPassword(): string {
  return randomBytes(16).toString("base64url").slice(0, 18);
}

/** "demo-app, gip-plateforme" -> ['demo-app','gip-plateforme'] ; vide -> null (toutes). */
function parseApps(raw: string): string[] | null {
  const apps = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return apps.length ? apps : null;
}

async function audit(adminEmail: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
    adminEmail,
    action,
    detail,
  ]);
}

export async function createUserAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const role = String(fd.get("role")) === "admin" ? "admin" : "viewer";
  const apps = parseApps(String(fd.get("apps") ?? ""));
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) redirect("/admin/users?error=email");

  const password = genPassword();
  const hash = await bcrypt.hash(password, 10);
  let inserted = true;
  try {
    await q(
      `insert into console_user (email, password_hash, role, apps) values ($1, $2, $3, $4)`,
      [email, hash, role, apps],
    );
  } catch {
    inserted = false; // email déjà pris (contrainte unique)
  }
  if (!inserted) redirect("/admin/users?error=exists");

  await audit(admin.email, "user_create", `${email} role=${role} apps=${apps?.join("|") ?? "toutes"}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users?pwt=${stashSecret(password)}&pwe=${encodeURIComponent(email)}`);
}

export async function toggleUserAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (email === admin.email) redirect("/admin/users?error=self"); // anti-lockout
  const [u] = await q<{ active: boolean }>(
    `update console_user set active = not active where email = $1 returning active`,
    [email],
  );
  if (u) await audit(admin.email, "user_update", `${email} active=${u.active}`);
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function resetPasswordAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = genPassword();
  const hash = await bcrypt.hash(password, 10);
  const [u] = await q<{ email: string }>(
    `update console_user set password_hash = $2 where email = $1 returning email`,
    [email, hash],
  );
  if (!u) redirect("/admin/users?error=unknown");
  await audit(admin.email, "user_reset_password", email);
  revalidatePath("/admin/users");
  redirect(`/admin/users?pwt=${stashSecret(password)}&pwe=${encodeURIComponent(email)}`);
}
