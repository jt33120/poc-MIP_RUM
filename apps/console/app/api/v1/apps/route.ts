// GET /api/v1/apps — catalogue des apps. Filtré au scope du principal : un viewer
// scopé ne voit que ses apps autorisées (un token / admin voit tout). Un principal
// sans aucune app n'arrive pas ici : `handle` le refuse (403 no_app_access).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { listApps } from "@/lib/queries";
import { authorizedAppsOf } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal }) => {
  const apps = await listApps();
  const authorized = authorizedAppsOf(principal);
  return { apps: authorized === null ? apps : apps.filter((a) => authorized.includes(a.app_id)) };
});
