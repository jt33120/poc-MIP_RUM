// GET /api/v1/apps — catalogue des apps. Filtré au scope du principal : un viewer
// scopé ne voit que ses apps autorisées (un token / admin voit tout).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { listApps } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal }) => {
  const apps = await listApps();
  const scoped = principal.apps?.length
    ? apps.filter((a) => principal.apps!.includes(a.app_id))
    : apps;
  return { apps: scoped };
});
