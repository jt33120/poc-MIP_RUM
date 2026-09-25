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
import { chargerAcquisition } from "@/lib/chargeurs/acquisition";
import { chargerActions } from "@/lib/chargeurs/actions";
import { chargerAi } from "@/lib/chargeurs/ai";
import { chargerCoquille } from "@/lib/chargeurs/coquille";
import { chargerCorrelation } from "@/lib/chargeurs/correlation";
import { chargerErreur } from "@/lib/chargeurs/erreur";
import { chargerErrors } from "@/lib/chargeurs/errors";
import { chargerEvents } from "@/lib/chargeurs/events";
import { chargerExperience } from "@/lib/chargeurs/experience";
import { chargerExplorer } from "@/lib/chargeurs/explorer";
import { chargerForecast } from "@/lib/chargeurs/forecast";
import { chargerForms } from "@/lib/chargeurs/forms";
import { chargerGoals } from "@/lib/chargeurs/goals";
import { chargerIssue } from "@/lib/chargeurs/issue";
import { chargerLogs } from "@/lib/chargeurs/logs";
import { chargerMap } from "@/lib/chargeurs/map";
import { chargerMobile } from "@/lib/chargeurs/mobile";
import { chargerOverview } from "@/lib/chargeurs/overview";
import { chargerPages } from "@/lib/chargeurs/pages";
import { chargerPaths } from "@/lib/chargeurs/paths";
import { chargerRejeu } from "@/lib/chargeurs/rejeu";
import { chargerRetention } from "@/lib/chargeurs/retention";
import { chargerSession } from "@/lib/chargeurs/session";
import { chargerSessions } from "@/lib/chargeurs/sessions";
import { chargerSvi, chargerSviAppel, chargerSviAppels } from "@/lib/chargeurs/svi";
import { chargerTrace } from "@/lib/chargeurs/trace";
import { chargerTracing } from "@/lib/chargeurs/tracing";
import { chargerUx } from "@/lib/chargeurs/ux";
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
    // C4
    overview: page(chargerOverview),
    forecast: page(chargerForecast),
    pages: page(chargerPages),
    ux: page(chargerUx),
    map: page(chargerMap),
    errors: page(chargerErrors),
    erreur: page(chargerErreur),
    issue: page(chargerIssue),
    tracing: page(chargerTracing),
    trace: page(chargerTrace),
    correlation: page(chargerCorrelation),
    // C5
    acquisition: page(chargerAcquisition),
    forms: page(chargerForms),
    retention: page(chargerRetention),
    paths: page(chargerPaths),
    experience: page(chargerExperience),
    goals: page(chargerGoals),
    svi: page(chargerSvi),
    sviAppels: page(chargerSviAppels),
    sviAppel: page(chargerSviAppel),
    logs: page(chargerLogs),
    ai: page(chargerAi),
  },
  refusDeFiltre: (e) => (e instanceof UnsupportedFilterError ? { code: e.error.code, message: e.error.message } : null),
};
