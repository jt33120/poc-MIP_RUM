"use server";
// Server Actions /admin/extension-scope (Ext-C) — enregistre/active un domaine
// pour l'extension navigateur, admin only, tracé dans audit_log. Aucun secret ici
// (contrairement aux tokens de lecture) : juste un mapping domaine -> app_id.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { allowOriginForApp, createExtensionScope, toggleExtensionScope } from "@/lib/queries-extension-scope";

async function audit(email: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [email, action, detail]);
}

/** Normalise un hostname saisi (retire protocole/chemin/port éventuels). */
function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  return s;
}

export async function createExtensionScopeAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const domain = normalizeDomain(String(fd.get("domain") ?? ""));
  const app = String(fd.get("app") ?? "").trim();
  if (!domain || !app) redirect("/admin/extension-scope?error=1");
  await createExtensionScope(domain, app);
  // Onboarding en une étape : autorise aussi l'origine HTTPS du domaine à poster
  // vers l'ingestion (CORS). Sans ça, le préflight bloque le POST OTLP de
  // l'extension — le domaine est « reconnu » mais aucune donnée n'arrive.
  await allowOriginForApp(domain, app);
  await audit(admin.email, "extension_scope_create", `${domain} -> ${app} (+origine CORS)`);
  revalidatePath("/admin/extension-scope");
  redirect("/admin/extension-scope");
}

export async function toggleExtensionScopeAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(fd.get("id"));
  const active = fd.get("active") === "1";
  if (!Number.isFinite(id)) redirect("/admin/extension-scope");
  await toggleExtensionScope(id, active);
  await audit(admin.email, "extension_scope_toggle", `id=${id} active=${active}`);
  revalidatePath("/admin/extension-scope");
  redirect("/admin/extension-scope");
}
