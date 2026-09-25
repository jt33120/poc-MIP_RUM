"use server";
// Server action du workflow d'une issue (P5.6, P8.6) : triage, commentaire, lien de
// ticket, demande de ticket. Appelée par les formulaires de l'issue
// (`components/errors/IssueWorkflowForms.tsx`), qui postaient avant C7 vers les
// routes v1 `POST /api/v1/issues/{id}/…` — retirées du contrat public : une
// écriture de la console passe par une COMMANDE (`lib/commandes/issues.ts`), que
// console-api servira.
//
// Elle rend ce que le formulaire sait dire : écrit (la page se relit), CONFLIT (l'issue
// a changé depuis sa lecture : recharger), ou un refus en toutes lettres.
import { headers } from "next/headers";
import { executerCommande } from "@/lib/commande";
import { origineConsole } from "@/lib/queries-ticket-integrations";

export type ActionIssue = "triage" | "comments" | "links" | "tickets";

export type RetourIssue = { etat: "ok" } | { etat: "conflit"; message: string } | { etat: "erreur"; message: string };

const COMMANDE = { triage: "trierIssue", comments: "commenterIssue", links: "lierTicket", tickets: "demanderTicket" } as const;

/** Les refus d'accès, dits à l'administrateur (la page ne rend les formulaires qu'à lui). */
const REFUS: Record<string, string> = {
  session_requise: "Session expirée : se reconnecter.",
  demo_refusee: "Session de démonstration : lecture seule.",
  role_insuffisant: "Réservé aux administrateurs.",
  hors_perimetre: "Cette application n'est pas dans votre périmètre.",
};

/** Les en-têtes de la requête de la console ; vides hors requête (le test d'une server action). */
async function entetes(): Promise<Headers> {
  try {
    return await headers();
  } catch {
    return new Headers();
  }
}

export async function muterIssue(issueId: string, action: ActionIssue, champs: Record<string, unknown>): Promise<RetourIssue> {
  const cle = COMMANDE[action];
  if (!cle) return { etat: "erreur", message: "action inconnue" };
  // L'application voyage avec le formulaire : c'est la PORTÉE de la commande, pas un champ du corps.
  const { app, ...corps } = champs;
  const r = await executerCommande(cle, {
    app: typeof app === "string" ? app : null,
    chemin: { id: issueId },
    // Les liens du ticket mènent à la console : son origine vient de SA requête (ou de
    // `MIP_CONSOLE_URL`), jamais du formulaire — une valeur envoyée par lui est écrasée.
    corps: action === "tickets" ? { ...corps, origine: origineConsole(await entetes()) } : corps,
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
