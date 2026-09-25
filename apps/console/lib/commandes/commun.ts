// CE QUE PARTAGENT LES COMMANDES (C6 → C9) : les écritures de la console.
//
// Une commande est à une écriture ce qu'un chargeur est à un écran : le code qui
// ÉCRIT, sans rien savoir du transport. Elle reçoit le principal, l'application
// visée (sa portée), les paramètres du chemin et un corps déjà validé ; elle
// écrit, inscrit son audit dans la MÊME transaction, et rend une DÉCISION
// (`ok`, `introuvable`, `conflit`…) — jamais une redirection ni un rendu : c'est
// la server action qui les tire de la décision.
//
// Elle tourne à deux endroits, à l'octet près :
//   · dans la console, aujourd'hui : la server action l'appelle par sa clé,
//     `executerCommande("creerObjectif", …)` (`lib/commande-locale.ts`), avec le
//     principal de la session ;
//   · dans console-api, qui l'embarque (`services/console-api/commandes.mjs`) et
//     la sert sous son opération (`COMMANDES` du contrat), avec le principal relu
//     en base.
// Sa RÈGLE (qui, quelle portée, quel audit) est déclarée avec elle : le pipeline
// du service en fait sa politique, la console l'applique par `refusDAcces` avant
// de l'appeler. Son VALIDATEUR d'entrée aussi : le service refuse en 400 ce que la
// console refuse avant d'écrire.
import type { RegleCommande, Validateur } from "@mip/console-contract";
import { ecrireAudit, type Requetable } from "./audit";

/** Le principal d'une commande : celui de la session (console) ou relu en base (console-api). */
export interface PrincipalCommande {
  readonly email: string;
  readonly role: "admin" | "viewer";
  /** `null` = toutes les applications ; `[]` = aucune. */
  readonly apps: string[] | null;
  readonly demo?: boolean;
}

/** Ce qu'une commande reçoit, quel que soit le côté qui l'exécute. */
export interface DemandeCommande<P, B> {
  readonly principal: PrincipalCommande;
  /** L'application de la portée `app` (nommée, dans le périmètre) ; `null` sous portée `globale`. */
  readonly app: string | null;
  readonly chemin: P;
  readonly corps: B;
  /** L'identifiant de la requête, pour l'audit et le journal ; `null` hors requête (tests). */
  readonly requestId: string | null;
}

/** Ce que l'exécution d'une commande reçoit en plus : sa ligne d'audit, liée à SA règle. */
export interface ExecutionCommande<P, B> extends DemandeCommande<P, B> {
  /**
   * Inscrit l'action d'audit de la règle, dans la transaction de `client`, avec
   * le détail donné. `app` : l'application de la ligne quand la portée ne la
   * porte pas (un tableau de bord, résolu par la commande).
   */
  auditer(client: Requetable, detail: string | null, app?: string | null): Promise<void>;
}

export interface Commande<P, B, R> {
  readonly regle: RegleCommande;
  /** Les paramètres du chemin (`{id}`…), validés avant la commande. Absent : aucun. */
  readonly chemin?: Validateur<P>;
  /** Le corps, validé avant la commande. Absent : la commande n'en prend pas. */
  readonly corps?: Validateur<B>;
  executer(demande: DemandeCommande<P, B>): Promise<R>;
}

type Aucun = Record<string, never>;

/**
 * Déclare une commande : sa règle et ses validateurs, puis son exécution — deux
 * arguments, pour que les types du chemin et du corps, tirés des validateurs,
 * soient connus de l'exécution.
 */
export function commande<P = Aucun, B = undefined, R = unknown>(
  def: {
    readonly regle: RegleCommande;
    readonly chemin?: Validateur<P>;
    readonly corps?: Validateur<B>;
  },
  executer: (e: ExecutionCommande<P, B>) => Promise<R>,
): Commande<P, B, R> {
  const { regle } = def;
  return Object.freeze({
    regle,
    ...(def.chemin ? { chemin: def.chemin } : {}),
    ...(def.corps ? { corps: def.corps } : {}),
    executer: (d: DemandeCommande<P, B>) =>
      executer({
        ...d,
        auditer: (client, detail, app) => {
          if (typeof regle.audit !== "string") {
            // Une commande exemptée qui audite quand même : sa règle ment. À corriger dans la règle.
            throw new Error("commande exemptée d'audit : sa règle ne déclare aucune action");
          }
          return ecrireAudit(client, {
            email: d.principal.email,
            action: regle.audit,
            detail,
            requestId: d.requestId,
            app: app === undefined ? d.app : app,
          });
        },
      }),
  });
}

/**
 * Une commande quelconque, pour le registre et les exécuteurs : le registre
 * efface ses types d'entrée, que `lib/commande-locale.ts` retrouve par clé.
 */
export type CommandeQuelconque = Commande<any, any, unknown>;

/** L'identifiant entier d'une ligne, tel qu'un chemin le porte (`/v1/goals/{id}`). */
export const MOTIF_ENTIER = /^[1-9][0-9]{0,17}$/;
/** Une révision citée : l'entier lu, ou `0` quand le formulaire n'en portait pas (toujours un conflit). */
export const MOTIF_REVISION = /^(0|[1-9][0-9]{0,18})$/;
