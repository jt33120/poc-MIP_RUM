// LES ÉCRITURES SERVIES PAR console-api (C6 → C9) : les commandes de la console,
// embarquées par le build (alias `@/` → `apps/console`), à la signature de
// `@mip/console-api`.
//
// Une commande de la console reçoit ce que reçoit sa server action : le principal,
// l'application de sa portée, les paramètres du chemin et un corps validé. Ici, le
// principal est celui que le pipeline a relu EN BASE (session → compte), et chaque
// appel porte son `request_id` jusqu'au journal et à la ligne d'audit.
//
// Ajouter une écriture : sa commande dans `apps/console/lib/commandes/index.ts`,
// son opération dans `COMMANDES` du contrat — le type de `@mip/console-api` refuse
// une opération du contrat sans commande.
import { COMMANDES_CONSOLE } from "@/lib/commandes";
import { avecRequete } from "./shims/log-forward.mjs";

/** @param {import("@mip/console-api").DemandeServie["principal"]} p */
const principal = (p) => ({ email: p.email, role: p.role, apps: p.apps === null ? null : [...p.apps], demo: p.demo });

/** @type {import("@mip/console-api").CommandesServies} */
export const commandes = Object.fromEntries(
  Object.entries(COMMANDES_CONSOLE).map(([cle, c]) => [
    cle,
    {
      regle: c.regle,
      ...(c.chemin ? { chemin: c.chemin } : {}),
      ...(c.corps ? { corps: c.corps } : {}),
      executer: (d) =>
        avecRequete(d.requestId, () =>
          c.executer({ principal: principal(d.principal), app: d.app, chemin: d.chemin, corps: d.corps, requestId: d.requestId }),
        ),
    },
  ]),
);
