// GET /api/dashboards/[id]/export — export CSV d'un tableau de bord. Auth via
// cookie de session (getUser). Réutilise resolveWidgets + layoutToCsv pour que
// l'export et le rendu HTML partagent EXACTEMENT la même donnée : même contrat de
// filtres (P6.2), même AST de carte (P6.5), même intersection avec l'app du
// tableau de bord, mêmes refus.
//
// PLAFOND ET TRONCATURE. 10 000 lignes au total, annoncées dans le fichier quand
// elles sont atteintes. Les cellules qui commencent par `=`, `+`, `-` ou `@` sont
// préfixées : un export ne doit pas devenir une formule exécutée par un tableur.
//
// ANNULATION. `req.signal` est passé au résolveur : un export abandonné par le
// navigateur n'ouvre pas les lectures restantes.
import { getUser } from "@/lib/auth";
import {
  dashboardFilters,
  dashboardPrincipal,
  canDashboardAction,
  getAccessibleDashboard,
} from "@/lib/dashboard-access";
import { fuseauDe } from "@/lib/fuseau";
import { contractErrorStatus, parseAnalyticsQuery } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import { checkSurface, surfaceFor } from "@/lib/surfaces";
import { layoutToCsv, resolveWidgets } from "@/lib/widget-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await dashboardPrincipal(await getUser());
  if (!user) return new Response("unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const idNum = Number(id);
  const dash = Number.isInteger(idNum) ? await getAccessibleDashboard(idNum, user) : null;
  if (!dash || !canDashboardAction(user, dash, "export")) return new Response("not found", { status: 404 });

  const parsed = parseAnalyticsQuery(new URL(req.url).searchParams, { principal: user, nowMs: Date.now() });
  if (!parsed.ok) return new Response(parsed.error.message, { status: contractErrorStatus(parsed.error) });
  const surface = surfaceFor(`/dashboards/${dash.id}`);
  const check = surface ? checkSurface(parsed.value, surface, await dimensionSchema()) : null;
  if (check && !check.ok) return new Response(check.error.message, { status: 400 });
  const eff = dashboardFilters(dash, parsed.value, user);
  if (!eff) return new Response("not found", { status: 404 });

  const timeZone = await fuseauDe(parsed.value.scope.requestedApp);
  const data = await resolveWidgets(dash.layout, {
    filters: eff,
    timeZone,
    nowMs: Date.now(),
    signal: req.signal,
  });
  const csv = layoutToCsv(dash.name, dash.layout, data, new Date());

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dashboard-${dash.id}.csv"`,
    },
  });
}
