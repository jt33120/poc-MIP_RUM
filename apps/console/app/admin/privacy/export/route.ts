// Export DSAR (droit d'accès / portabilité) — GET admin only, renvoie le JSON
// complet des données d'un utilisateur en pièce jointe. Pas de redirect ici
// (endpoint de téléchargement) : 401/403 explicites si non-admin.
import { getUser } from "@/lib/auth";
import { DsarRefus, dsarExportFilename } from "@/lib/dsar";
import { dsarExport } from "@/lib/queries-dsar";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (user.role !== "admin") return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const visitorId = (url.searchParams.get("user") ?? "").trim();
  const app = (url.searchParams.get("app") ?? "all").trim() || "all";
  if (!visitorId) return new Response("missing user", { status: 400 });

  // horodatage figé de la génération (attribut du document + nom de fichier)
  const generatedAt = new Date().toISOString();
  let doc;
  try {
    doc = await dsarExport(app, visitorId, generatedAt);
  } catch (e) {
    // Un refus n'est pas une panne : il se dit, en clair, avec son motif. 409
    // plutôt que 400 — la demande est bien formée, c'est l'état de la donnée qui
    // interdit d'y répondre.
    if (e instanceof DsarRefus) {
      return new Response(e.message, {
        status: 409,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    throw e;
  }
  const filename = dsarExportFilename(visitorId, generatedAt);

  return new Response(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
