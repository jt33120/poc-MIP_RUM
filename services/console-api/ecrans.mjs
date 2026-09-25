// LES ÉCRANS SERVIS PAR console-api : les chargeurs de la console, embarqués par
// le build (alias `@/` → `apps/console`), à la signature de `@mip/console-api`.
//
// Un chargeur de la console reçoit ce que reçoit sa page : le principal, les
// paramètres d'URL, ceux du chemin. Ici, le principal est celui que le pipeline
// a relu EN BASE (session → compte), et chaque appel porte son `request_id`
// jusqu'au journal d'une section en échec. Le refus d'un filtre
// (`UnsupportedFilterError`) est reconnu ici, par sa classe : le pipeline le
// rend en 400 `filtre_non_supporte`, pas en panne.
//
// Ajouter un écran : son chargeur ici, son opération dans `ECRANS` du contrat —
// le type de `@mip/console-api` refuse un écran du contrat sans chargeur.
import { chargerActions } from "@/lib/chargeurs/actions";
import { chargerCoquille } from "@/lib/chargeurs/coquille";
import { chargerEvents } from "@/lib/chargeurs/events";
import { chargerExplorer } from "@/lib/chargeurs/explorer";
import { chargerMobile } from "@/lib/chargeurs/mobile";
import { chargerRejeu } from "@/lib/chargeurs/rejeu";
import { chargerSession } from "@/lib/chargeurs/session";
import { chargerSessions } from "@/lib/chargeurs/sessions";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { avecRequete } from "./shims/log-forward.mjs";

/** @param {import("@mip/console-api").PrincipalChargeur} p */
const principal = (p) => ({ email: p.email, role: p.role, apps: p.apps === null ? null : [...p.apps], demo: p.demo });

/**
 * @param {(p: ReturnType<typeof principal>, sp: Record<string, string>, chemin: Record<string, string>) => Promise<unknown>} chargeur
 * @returns {import("@mip/console-api").ChargeurEcran}
 */
const page = (chargeur) => (p, sp, chemin, requestId) => avecRequete(requestId, () => chargeur(principal(p), { ...sp }, { ...chemin }));

/** @type {import("@mip/console-api").ChargeursEcrans} */
export const ecrans = {
  coquille: (p) => chargerCoquille(principal(p)),
  pages: {
    // C3
    actions: page(chargerActions),
    events: page(chargerEvents),
    mobile: page(chargerMobile),
    sessions: page(chargerSessions),
    session: page(chargerSession),
    explorer: page(chargerExplorer),
    rejeu: page(chargerRejeu),
  },
  refusDeFiltre: (e) => (e instanceof UnsupportedFilterError ? { code: e.error.code, message: e.error.message } : null),
};
