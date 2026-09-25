// LES ÉCRITURES DE LA CONSOLE (C6 → C9) : une commande par opération, servie telle quelle.
//
// Les commandes vivent dans la console (`apps/console/lib/commandes/`) : c'est le
// code que ses server actions exécutent aujourd'hui. Le service les reçoit par
// INJECTION (`services/console-api/commandes.mjs`) — ce paquet n'importe rien de
// la console et se vérifie seul. Chaque commande apporte sa RÈGLE (qui, quelle
// portée, quel audit) et ses validateurs : la politique de l'opération en est
// TIRÉE ici, pas recopiée — la console applique la même règle
// (`refusDAcces` du contrat), et un test confronte les deux côtés.
//
//   règle `auth`     → politique `auth` (session, admin, admin de la plateforme) ;
//   règle `portee`   → `app` devient `une-app` : UNE application nommée du
//                      périmètre (`all` refusé), rendue à la commande ;
//   règle `audit`    → l'action d'audit (ou l'exemption motivée) de l'opération ;
//   toute commande   → `demo: "refus"` : c'est une écriture.
//
// Le corps est validé par le pipeline (étape 7) avec le validateur de la
// commande ; les paramètres du chemin, ici, avant elle. La commande rend sa
// DÉCISION — en 200 : `introuvable` ou `conflit` sont des réponses, pas des pannes.
import { COMMANDES, type Aucun, type CleCommande, type Operation, type RegleCommande, type Validateur } from "@mip/console-contract";
import { ErreurContrat } from "../erreurs";
import { servir, type Enregistrement, type Politique } from "../politique";
import type { PrincipalChargeur } from "./ecrans";

/** Ce qu'une commande reçoit du service : ce que la console lui passe, le principal relu en base. */
export interface DemandeServie {
  readonly principal: PrincipalChargeur;
  readonly app: string | null;
  readonly chemin: unknown;
  readonly corps: unknown;
  readonly requestId: string;
}

export interface CommandeServie {
  readonly regle: RegleCommande;
  readonly chemin?: Validateur<unknown>;
  readonly corps?: Validateur<unknown>;
  readonly executer: (d: DemandeServie) => Promise<unknown>;
}

/** Une commande par écriture du contrat (`COMMANDES`), sans exception : le type l'exige. */
export type CommandesServies = { readonly [K in CleCommande]: CommandeServie };

/** La politique d'une opération d'écriture, tirée de la règle de sa commande. */
export function politiqueDeCommande(c: Pick<CommandeServie, "regle" | "corps">): Politique {
  return {
    auth: c.regle.auth,
    portee: c.regle.portee === "app" ? "une-app" : "globale",
    demo: "refus",
    audit: c.regle.audit,
    ...(c.corps ? { entree: { corps: c.corps } } : {}),
  };
}

export function operationsCommandes(c: CommandesServies): Enregistrement[] {
  return (Object.keys(COMMANDES) as CleCommande[]).map((cle) => {
    const cmd = c[cle];
    return servir(
      COMMANDES[cle] as Operation<Readonly<Record<string, string>>, Aucun, unknown, unknown>,
      politiqueDeCommande(cmd),
      async ({ principal, params, corps, appDemandee, requestId }) => {
        if (principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
        let chemin: unknown = params ?? {};
        if (cmd.chemin) {
          const v = cmd.chemin(chemin, "chemin");
          if (!v.ok) throw new ErreurContrat("entree_invalide", v.error.message, { details: { champ: v.error.champ } });
          chemin = v.value;
        }
        return cmd.executer({
          principal: { email: principal.email, role: principal.role, apps: principal.apps, demo: principal.demo },
          app: appDemandee,
          chemin,
          corps,
          requestId,
        });
      },
    );
  });
}
