"use server";
// Server action du workflow d'une issue (P5.6) : triage, commentaire. Appelée par les formulaires de l'issue
// (`components/errors/IssueWorkflowForms.tsx`), qui postaient avant C7 vers les
// routes v1 `POST /api/v1/issues/{id}/…` — retirées du contrat public : une
// écriture de la console passe par une COMMANDE (`lib/commandes/issues.ts`), que
// console-api servira.
//
// Elle rend ce que le formulaire sait dire : écrit (la page se relit), CONFLIT (l'issue
// a changé depuis sa lecture : recharger), ou un refus en toutes lettres.
import { executerCommande } from "@/lib/commande";

export type ActionIssue = "triage" | "comments";

export type RetourIssue = { etat: "ok" } | { etat: "conflit"; message: string } | { etat: "erreur"; message: string };

const COMMANDE = { triage: "trierIssue", comments: "commenterIssue" } as const;

/** Les refus d'accès, dits à l'administrateur (la page ne rend les formulaires qu'à lui). */
const REFUS: Record<string, string> = {
  session_requise: "Session expirée : se reconnecter.",
  demo_refusee: "Session de démonstration : lecture seule.",
  role_insuffisant: "Réservé aux administrateurs.",
  hors_perimetre: "Cette application n'est pas dans votre périmètre.",
};

export async function muterIssue(issueId: string, action: ActionIssue, champs: Record<string, unknown>): Promise<RetourIssue> {
  const cle = COMMANDE[action];
  if (!cle) return { etat: "erreur", message: "action inconnue" };
  // L'application voyage avec le formulaire : c'est la PORTÉE de la commande, pas un champ du corps.
  const { app, ...corps } = champs;
  const r = await executerCommande(cle, {
    app: typeof app === "string" ? app : null,
    chemin: { id: issueId },
    corps,
  });
  if (!r.ok) return { etat: "erreur", message: REFUS[r.code] ?? r.message };
  const d = r.data as { kind: string; error?: string };
  switch (d.kind) {
    case "ok":
      return { etat: "ok" };
    case "conflict":
      return { etat: "conflit", message: d.error ?? "L'issue a été modifiée entre-temps." };
    case "not_found":
      return { etat: "erreur", message: "Issue introuvable." };
    case "unavailable":
      return { etat: "erreur", message: "Workflow des issues indisponible sur cette base." };
    default:
      return { etat: "erreur", message: d.error ?? "Échec de l'enregistrement." };
  }
}
