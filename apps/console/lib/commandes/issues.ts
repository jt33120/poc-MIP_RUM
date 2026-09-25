// LE WORKFLOW DES ERREURS (C7) — `app/errors/issues/actions.ts`, `app/errors/[fingerprint]/actions.ts`.
//
// Une issue se trie (statut, assigné), se commente, reçoit un lien de ticket ou une
// demande de création de ticket ; un groupe historique (avant les issues) se trie
// par son empreinte. L'administrateur de l'application seul : la règle est `admin`
// + portée `app`, et la mutation cherche l'issue DANS cette application — un
// identifiant d'une autre application est introuvable, comme absent.
//
// La logique est celle du module du workflow (`lib/error-issue-workflow.ts`) et de
// la file des tickets (`lib/queries-ticket-integrations.ts`) : révision citée,
// verrou, activité et révision dans UNE transaction — l'audit de la commande y
// entre aussi. Leurs analyseurs valident le corps ; l'application du corps est
// celle de la portée, jamais une autre.
//
// Avant C7, ces écritures étaient des routes de l'API v1 appelées par le
// navigateur (`POST /api/v1/issues/{id}/…`). Elles ont quitté le contrat public :
// une écriture de la console passe par une commande, que console-api servira.
import { chaine, libre, objet, parmi } from "@mip/console-contract";
import { tx } from "../db";
import { commentIssue, linkIssue, parseCommentRequest, parseLinkRequest, parseTriageRequest, triageIssue } from "../error-issue-workflow";
import { demanderTicket as inscrireDemande, parseDemandeTicket } from "../queries-ticket-integrations";
import { ERROR_STATUSES, setErrorStatus } from "../queries-v2";
import { commande } from "./commun";

const CHEMIN_ISSUE = objet({
  id: chaine({ max: 36, motif: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, description: "identifiant d'issue (UUID)" }),
});
/** Le corps, borné : son sens est vérifié par l'analyseur du workflow (16 Kio, comme la route qui l'acceptait). */
const CORPS = libre({ octetsMax: 16 * 1024 });

/** Le corps, avec l'application de la PORTÉE : une autre, portée par le corps, ne compte pas. */
function avecApp(corps: unknown, app: string | null): unknown {
  return corps !== null && typeof corps === "object" && !Array.isArray(corps) ? { ...corps, app } : corps;
}

export const trierIssue = commande(
  { regle: { auth: "admin", portee: "app", audit: "issue.triage" }, chemin: CHEMIN_ISSUE, corps: CORPS },
  async ({ principal, app, chemin, corps, auditer }) => {
    const demande = parseTriageRequest(avecApp(corps, app));
    if (!demande.ok) return { kind: "invalid", error: demande.error } as const;
    return triageIssue({ issueId: chemin.id, apps: [app!], actorEmail: principal.email, auditer }, demande.value);
  },
);

export const commenterIssue = commande(
  { regle: { auth: "admin", portee: "app", audit: "issue.comment" }, chemin: CHEMIN_ISSUE, corps: CORPS },
  async ({ principal, app, chemin, corps, auditer }) => {
    const demande = parseCommentRequest(avecApp(corps, app));
    if (!demande.ok) return { kind: "invalid", error: demande.error } as const;
    return commentIssue({ issueId: chemin.id, apps: [app!], actorEmail: principal.email, auditer }, demande.value);
  },
);

export const lierTicket = commande(
  { regle: { auth: "admin", portee: "app", audit: "issue.link" }, chemin: CHEMIN_ISSUE, corps: CORPS },
  async ({ principal, app, chemin, corps, auditer }) => {
    const demande = parseLinkRequest(avecApp(corps, app));
    if (!demande.ok) return { kind: "invalid", error: demande.error } as const;
    return linkIssue({ issueId: chemin.id, apps: [app!], actorEmail: principal.email, auditer }, demande.value);
  },
);

/**
 * Une demande de création de ticket (P8.6) : inscrite dans la file de sortie, livrée
 * au tick suivant — le ticket n'existe pas encore quand on répond. `origine` est
 * l'adresse publique de la console, que la server action tire de SA requête (les
 * liens du ticket y mènent) : la commande ne lit aucun en-tête.
 */
export const demanderTicket = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "issue.request_ticket" },
    chemin: CHEMIN_ISSUE,
    corps: objet({
      integrationId: chaine({ max: 18, motif: /^[1-9][0-9]{0,17}$/, description: "identifiant d'intégration" }),
      expectedRevision: chaine({ max: 19, motif: /^[1-9][0-9]{0,18}$/, description: "révision lue" }),
      origine: chaine({ min: 0, max: 512, motif: /^(https?:\/\/[^\s/?#]+)?$/, description: "origine de la console" }),
    }),
  },
  async ({ principal, app, chemin, corps, auditer }) => {
    const demande = parseDemandeTicket({ app, integrationId: corps.integrationId, expectedRevision: corps.expectedRevision });
    if (!demande.ok) return { kind: "invalid", error: demande.error } as const;
    return inscrireDemande({ issueId: chemin.id, apps: [app!], actorEmail: principal.email, auditer }, demande.value, corps.origine);
  },
);

/** Le statut d'un groupe historique (résolu, ignoré, rouvert), par son empreinte. */
export const trierGroupe = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "error.set_status" },
    chemin: objet({ fingerprint: chaine({ max: 200, description: "empreinte" }) }),
    corps: objet({ status: parmi(ERROR_STATUSES) }),
  },
  async ({ principal, app, chemin, corps, auditer }) => {
    await tx(async (c) => {
      await setErrorStatus(app!, chemin.fingerprint, corps.status, principal.email, c);
      await auditer(c, `${app}/${chemin.fingerprint} -> ${corps.status}`);
    });
    return { etat: "ok" } as const;
  },
);
