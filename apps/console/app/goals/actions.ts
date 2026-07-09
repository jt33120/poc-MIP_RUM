"use server";
// Server Actions /goals (Lot 8b) — gestion des objectifs, admin only, tracée
// dans audit_log. Le pattern et le nom sont des données libres (paramétrées) ;
// kind/match_type sont validés contre une allowlist.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";

async function audit(email: string, action: string, detail: string): Promise<void> {
  await q(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [email, action, detail]);
}

const KINDS = new Set(["pageview", "event"]);
const MATCHES = new Set(["exact", "contains"]);

export async function createGoalAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const app = String(fd.get("app") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  const kind = String(fd.get("kind") ?? "");
  const pattern = String(fd.get("pattern") ?? "").trim();
  const matchType = String(fd.get("match_type") ?? "exact");
  if (!app || !name || !pattern || !KINDS.has(kind) || !MATCHES.has(matchType)) {
    redirect("/goals?error=champs");
  }
  await q(
    `insert into goal (app_id, name, kind, pattern, match_type) values ($1, $2, $3, $4, $5)`,
    [app, name, kind, pattern, matchType],
  );
  await audit(admin.email, "goal_create", `${app} "${name}" ${kind}:${matchType} ${pattern}`);
  revalidatePath("/goals");
  redirect(`/goals?app=${encodeURIComponent(app)}`);
}

export async function toggleGoalAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(fd.get("id"));
  if (!Number.isFinite(id)) redirect("/goals");
  const [g] = await q<{ active: boolean; name: string }>(
    `update goal set active = not active where id = $1 returning active, name`,
    [id],
  );
  if (g) await audit(admin.email, "goal_update", `${g.name} active=${g.active}`);
  revalidatePath("/goals");
  redirect("/goals");
}

export async function deleteGoalAction(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(fd.get("id"));
  if (!Number.isFinite(id)) redirect("/goals");
  const [g] = await q<{ name: string }>(`delete from goal where id = $1 returning name`, [id]);
  if (g) await audit(admin.email, "goal_delete", g.name);
  revalidatePath("/goals");
  redirect("/goals");
}
