// GET /api/dashboards/[id]/export — export CSV d'un tableau de bord. Auth via
// cookie de session (getUser). Le chargeur (`lib/chargeurs/export-tableau.ts`, C6)
// partage EXACTEMENT la donnée de l'écran : même porte, même contrat de filtres,
// même intersection avec l'app du tableau, mêmes refus ; console-api le sert sous
// `dashboards.export`. Ici : le statut HTTP de sa décision, et le fichier.
//
// ANNULATION. `req.signal` est passé au chargeur — ou à l'appel de console-api,
// après la bascule : un export abandonné par le navigateur n'ouvre pas les
// lectures restantes.
import { CODES_ERREUR, ECRANS } from "@mip/console-contract";
import { chargerExportTableau } from "@/lib/chargeurs/export-tableau";
import { lireEcran } from "@/lib/ecran";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const lu = await lireEcran(ECRANS.exportTableau, (p, s, chemin) => chargerExportTableau(p, s, chemin, req.signal), sp, { id }, { signal: req.signal });
  if (!lu.ok) {
    // Mode strict : le refus du service, avant le chargeur, en statut HTTP.
    const code = lu.refus.code === "session_invalide" ? "session_requise" : lu.refus.code;
    return new Response(code === "session_requise" ? "unauthorized" : lu.refus.message, { status: (CODES_ERREUR as Record<string, number>)[code] ?? 503 });
  }
  const r = lu.data;
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
