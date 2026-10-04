// GET /api/v1/user-timings — SERVIE PAR LE SERVICE `api` SEUL (`ROUTES_SERVICE_SEUL` de
// `services/api/routeur.mjs`) ; la route de la console la transmet
// (`app/api/v1/user-timings/route.ts`, `lib/api/service-seul.ts`) et n'exécute jamais
// ce module : la console n'y gagne aucune lecture de base.
//
// Les repères du développeur, par nom : `performance.mark` (`mark:<nom>`, instant
// depuis le début de la vue), `performance.measure` (`measure:<nom>`, durée), relevés
// par le SDK, et les `addTiming` manuels. Les démarrages de l'app mobile restent sur
// /mobile/summary. Lecture : `reperesParNom` (`lib/queries-engagement.ts`), celle de
// l'écran /pages.
import { reperesParNom } from "../../queries-engagement";
import { handle } from "../handle";
import { parsePagination } from "../pagination";
import { preflight } from "../respond";
import { SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX } from "../signaux-vue";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const { limit } = parsePagination(searchParams, SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX);
  return reperesParNom(filters.legacy, limit);
});
