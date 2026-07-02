"use server";
// Ajout self-service d'un site à monitorer depuis /select (le « + »). Réutilise
// exactement la mécanique de /admin/customers (app_registry + clé hashée sha256 +
// stash mémoire pour un affichage unique), mais avec un formulaire minimal
// (nom + URL) : l'app_id est dérivé du nom, l'origine CORS de l'URL. Admin only,
// audité.
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requireAdmin, stashSecret } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatApiKey, parseOrigins, validateAppId } from "@/lib/onboarding";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** "Ma Boutique Démo" -> "ma-boutique-demo" (slug app_id stable). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createSiteAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const name = String(fd.get("name") ?? "").trim();
  const url = String(fd.get("url") ?? "").trim();
  const rawId = String(fd.get("app_id") ?? "").trim();

  if (!name) redirect("/select/new?error=name");
  const appId = validateAppId(rawId || slugify(name));
  if (!appId) redirect("/select/new?error=app_id");
  const { origins, invalid } = parseOrigins(url);
  if (invalid.length || !origins.length) redirect("/select/new?error=url");

  const apiKey = formatApiKey(randomBytes(16).toString("hex"));
  let inserted = true;
  try {
    await q(
      `insert into app_registry (app_id, name, api_key_hash, active, allowed_origins, created_by)
       values ($1, $2, $3, true, $4, $5)`,
      [appId, name, sha256(apiKey), origins, admin.email],
    );
  } catch {
    inserted = false; // app_id déjà pris (PK)
  }
  if (!inserted) redirect("/select/new?error=exists");

  await q(`insert into audit_log (user_email, action, detail) values ($1, 'app_create', $2)`, [
    admin.email,
    `${appId} (${name}) via /select`,
  ]);
  redirect(`/select/new?app=${encodeURIComponent(appId)}&kt=${stashSecret(apiKey)}`);
}
