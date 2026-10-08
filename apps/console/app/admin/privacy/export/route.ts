// Export DSAR (droit d'accès / portabilité) — le document JSON de ce qui est lié à
// une personne, en pièce jointe. C10 — l'export est une COMMANDE
// (`exporterIdentite`, `exporterVisiteur`) : l'administrateur de l'application
// (« toutes » : la plateforme), la divulgation inscrite au journal, refus compris.
// Pas de redirection ici (endpoint de téléchargement) : les statuts disent le refus.
//
// La personne visée vient de la DEMANDE SCELLÉE (cookie `SameSite=Strict`,
// `lib/demande-rgpd.ts`), jamais de l'URL (audit du 07/10/2026) : le lien
// `/admin/privacy/export` ne porte aucun identifiant, un lien venu d'un autre site
// n'emporte pas le cookie, et des paramètres d'URL sont ignorés.
import { executerCommande } from "@/lib/commande";
import { lireDemande } from "../demande";

export const dynamic = "force-dynamic";

const texte = (message: string, status: number) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** Le statut HTTP d'un refus d'accès ou d'entrée, avant la commande. */
const STATUT: Record<string, number> = { session_requise: 401, entree_invalide: 400 };

export async function GET(): Promise<Response> {
  const demande = await lireDemande();
  if (!demande) return texte("missing identity", 400);
  const r =
    demande.type === "identite"
      ? await executerCommande("exporterIdentite", { app: demande.app, corps: { kind: demande.kind, identity_hash: demande.hash } })
      : await executerCommande("exporterVisiteur", { corps: { app: demande.app, visitor_id: demande.visitorId } });
  if (!r.ok) return texte(r.code, STATUT[r.code] ?? 403);
  const d = r.data;
  if (d.etat === "vide") return texte("missing identity", 400);
  if (d.etat === "interdit") return texte("forbidden", 403);
  if (d.etat === "invalide") return texte("invalid app", 400);
  // Un refus n'est pas une panne : il se dit, en clair, avec son motif. 409 plutôt
  // que 400 — la demande est bien formée, c'est l'état de la donnée qui interdit
  // d'y répondre.
  if (d.etat === "refus") return texte(d.message, 409);
  return new Response(JSON.stringify(d.document, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${d.fichier}"`,
      "cache-control": "no-store",
    },
  });
}
