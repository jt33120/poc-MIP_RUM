// GET /api/dashboards/[id]/export — export CSV d'un tableau de bord (P1). Auth via
// cookie de session (getUser). Réutilise resolveWidget + widgetToCsv pour que
// l'export et le rendu HTML partagent EXACTEMENT la même donnée.
import { getUser } from "@/lib/auth";
import { parseFilters, type Filters } from "@/lib/filters";
import { getDashboard } from "@/lib/queries-dashboards";
import { resolveWidget, widgetToCsv } from "@/lib/widget-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const idNum = Number(id);
  const dash = Number.isInteger(idNum) ? await getDashboard(idNum) : null;
  if (!dash) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const f = parseFilters(Object.fromEntries(url.searchParams));
  const eff: Filters = { ...f, app: dash.app_id ?? f.app };

  const blocks = await Promise.all(
    dash.layout.map(async (w) => widgetToCsv(w.title, await resolveWidget(w, eff))),
  );
  const header = `# Dashboard: ${dash.name} (export ${new Date().toISOString()})`;
  const csv = [header, ...blocks].join("\n\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dashboard-${dash.id}.csv"`,
    },
  });
}
