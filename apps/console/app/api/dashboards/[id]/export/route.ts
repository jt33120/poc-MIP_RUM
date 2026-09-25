// GET /api/dashboards/[id]/export — export CSV d'un tableau de bord. Auth via
// cookie de session (getUser). Le chargeur (`lib/chargeurs/export-tableau.ts`, C6)
// partage EXACTEMENT la donnée de l'écran : même porte, même contrat de filtres,
// même intersection avec l'app du tableau, mêmes refus ; console-api le sert sous
// `dashboards.export`. Ici : le statut HTTP de sa décision, et le fichier.
//
// ANNULATION. `req.signal` est passé au chargeur : un export abandonné par le
// navigateur n'ouvre pas les lectures restantes.
import { getUser } from "@/lib/auth";
import { chargerExportTableau } from "@/lib/chargeurs/export-tableau";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const r = await chargerExportTableau(await getUser(), sp, { id }, req.signal);
  switch (r.etat) {
    case "sans_session":
      return new Response("unauthorized", { status: 401 });
    case "introuvable":
      return new Response("not found", { status: 404 });
    case "refus":
      return new Response(r.message, { status: r.statut });
    case "ok":
      return new Response(r.csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${r.fichier}"`,
        },
      });
  }
}
