"use server";
// Server Actions /admin/customers (v0.5) — création d'app cliente, rotation de
// clé, activation, origines CORS. Admin only, tout est audité. La clé d'API est
// générée côté serveur, stockée hashée (sha256), affichée UNE fois via le stash
// mémoire — même mécanique que les mots de passe de /admin/users.
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, stashSecret } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatApiKey, parseOrigins, validateAppId } from "@/lib/onboarding";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function audit(adminEmail: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
    adminEmail,
    action,
    detail,
  ]);
}

export async function createCustomerAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const appId = validateAppId(String(fd.get("app_id") ?? ""));
  const name = String(fd.get("name") ?? "").trim();
  const clientId = String(fd.get("client_id") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const { origins, invalid } = parseOrigins(String(fd.get("origins") ?? ""));

  if (!appId) redirect("/admin/customers?error=app_id");
  if (!name) redirect("/admin/customers?error=name");
  if (invalid.length)
    redirect(`/admin/customers?error=origin&detail=${encodeURIComponent(invalid[0])}`);
  if (!origins.length) redirect("/admin/customers?error=no_origin");

  const apiKey = formatApiKey(randomBytes(16).toString("hex"));
  let inserted = true;
  try {
    await q(
      `insert into app_registry (app_id, name, client_id, api_key_hash, active, allowed_origins, created_by, notes)
       values ($1, $2, $3, $4, true, $5, $6, $7)`,
      [appId, name, clientId, sha256(apiKey), origins, admin.email, notes],
    );
  } catch {
    inserted = false; // app_id déjà pris (PK)
  }
  if (!inserted) redirect("/admin/customers?error=exists");

  await audit(admin.email, "app_create", `${appId} (${name}) origins=${origins.join("|")}`);
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${appId}?kt=${stashSecret(apiKey)}`);
}

export async function rotateKeyAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const appId = String(fd.get("app_id") ?? "");
  const apiKey = formatApiKey(randomBytes(16).toString("hex"));
  const [row] = await q<{ app_id: string }>(
    `update app_registry set api_key_hash = $2 where app_id = $1 returning app_id`,
    [appId, sha256(apiKey)],
  );
  if (!row) redirect("/admin/customers?error=unknown");
  await audit(admin.email, "app_rotate_key", appId);
  revalidatePath(`/admin/customers/${appId}`);
  redirect(`/admin/customers/${appId}?kt=${stashSecret(apiKey)}`);
}

export async function toggleAppAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const appId = String(fd.get("app_id") ?? "");
  const [row] = await q<{ active: boolean }>(
    `update app_registry set active = not active where app_id = $1 returning active`,
    [appId],
  );
  if (row) await audit(admin.email, "app_update", `${appId} active=${row.active}`);
  revalidatePath("/admin/customers");
  redirect("/admin/customers");
}

export async function updateOriginsAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const appId = String(fd.get("app_id") ?? "");
  const { origins, invalid } = parseOrigins(String(fd.get("origins") ?? ""));
  if (invalid.length || !origins.length)
    redirect(`/admin/customers/${appId}?error=origin`);
  await q(`update app_registry set allowed_origins = $2 where app_id = $1`, [appId, origins]);
  await audit(admin.email, "app_update", `${appId} origins=${origins.join("|")}`);
  revalidatePath(`/admin/customers/${appId}`);
  redirect(`/admin/customers/${appId}`);
}
