// Export DSAR (droit d'accès / portabilité) — GET admin only, renvoie le JSON
// complet des données d'un utilisateur en pièce jointe. Pas de redirect ici
// (endpoint de téléchargement) : 401/403 explicites si non-admin.
import { getUser } from "@/lib/auth";
import { DsarRefus, dsarExportFilename } from "@/lib/dsar";
import { dsarExport } from "@/lib/queries-dsar";
import { dsarIdentityExport, type DsarIdentityKind } from "@/lib/queries-dsar";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (user.role !== "admin") return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const visitorId = (url.searchParams.get("user") ?? "").trim();
  const identityHash = (url.searchParams.get("identity_hash") ?? "").trim();
  const identityKind = (url.searchParams.get("kind") ?? "") as DsarIdentityKind;
  const app = (url.searchParams.get("app") ?? "all").trim() || "all";
  if (identityHash && (
    !/^[0-9a-f]{64}$/.test(identityHash) || app === "all" || !app ||
    (identityKind !== "user" && identityKind !== "account")
  )) {
    return new Response("invalid identity scope", { status: 400 });
  }
  if (!visitorId && !/^[0-9a-f]{64}$/.test(identityHash)) return new Response("missing identity", { status: 400 });

  // horodatage figé de la génération (attribut du document + nom de fichier)
  const generatedAt = new Date().toISOString();
  let doc;
  try {
    doc = identityHash
      ? await dsarIdentityExport(app, identityKind === "account" ? "account" : "user", identityHash, generatedAt)
      : await dsarExport(app, visitorId, generatedAt);
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
  await q(`insert into audit_log (user_email, action, detail) values ($1,$2,$3)`, [
    user.email,
    identityHash ? "dsar_identity_export" : "dsar_export",
    identityHash
      ? `kind=${identityKind} app=${app} hash_prefix=${identityHash.slice(0, 12)}`
      : `app=${app} visitor_id=${visitorId}`,
  ]);
  const filename = dsarExportFilename(identityHash || visitorId, generatedAt);

  return new Response(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
