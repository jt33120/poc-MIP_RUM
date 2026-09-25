// Des commandes FACTICES pour `creerTable` : la RÈGLE et les validateurs de chaque
// vraie commande de la console (ce qui fait la politique de son opération, donc la
// doc et le pipeline), mais une exécution qui rend ce qu'elle a reçu — pour les
// tests du pipeline, de l'identité et de la doc, qui n'ont pas de base.
// Les vraies commandes, sur une vraie base, sont dans la matrice d'autorisations
// (`tests/contract/console-api-authz.test.ts`).
import type { CommandesServies } from "@mip/console-api";
import { COMMANDES_CONSOLE } from "@/lib/commandes";

export const COMMANDES_FACTICES = Object.fromEntries(
  Object.entries(COMMANDES_CONSOLE).map(([cle, c]) => [
    cle,
    {
      regle: c.regle,
      ...(c.chemin ? { chemin: c.chemin } : {}),
      ...(c.corps ? { corps: c.corps } : {}),
      executer: async (d: unknown) => ({ recu: d }),
    },
  ]),
) as unknown as CommandesServies;
