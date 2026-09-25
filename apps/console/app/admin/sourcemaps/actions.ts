"use server";
// Server Actions /admin/sourcemaps (P5.4) — les jetons de CI d'upload de source
// maps. C9 — les COMMANDES `creerJetonSourcemap` et `revoquerJetonSourcemap`
// (`lib/commandes/raccordements.ts`) : l'administrateur de l'application du jeton,
// audité. Les formulaires (composants client) les appelaient par `fetch` sur
// `/api/admin/sourcemap-tokens`, route retirée : une écriture de la console passe
// par sa commande, que console-api servira.
//
// Le secret d'un jeton créé revient UNE fois, dans la réponse de l'action, vers le
// seul composant qui l'a demandé ; la base n'en garde que le hash.
import { executerCommande } from "@/lib/commande-locale";

export type RetourJeton = { ok: true; secret: string; nom: string } | { ok: false; erreur: string };

const REFUS: Record<string, string> = {
  session_requise: "Session expirée : se reconnecter.",
  demo_refusee: "Session de démonstration : lecture seule.",
  role_insuffisant: "Réservé aux administrateurs.",
  hors_perimetre: "Cette application n'est pas dans votre périmètre.",
};

export async function creerJetonSourcemapAction(appId: string, nom: string, jours: number): Promise<RetourJeton> {
  const r = await executerCommande("creerJetonSourcemap", {
    app: appId,
    corps: { name: nom, ...(Number.isInteger(jours) && jours >= 0 && jours <= 999 ? { expiresInDays: String(jours) } : {}) },
  });
  if (!r.ok) return { ok: false, erreur: REFUS[r.code] ?? r.message };
  const d = r.data;
  if (d.etat === "cree") return { ok: true, secret: d.secret, nom: d.token.name };
  if (d.etat === "refus") return { ok: false, erreur: d.message };
  return { ok: false, erreur: `application inconnue : ${appId}` };
}

export async function revoquerJetonSourcemapAction(appId: string, id: string): Promise<{ ok: boolean }> {
  const r = await executerCommande("revoquerJetonSourcemap", { app: appId, chemin: { id } });
  return { ok: r.ok && r.data.etat === "ok" };
}
