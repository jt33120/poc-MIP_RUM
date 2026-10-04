// GET /api/v1/spa-loads — SERVIE PAR LE SERVICE `api` SEUL (`ROUTES_SERVICE_SEUL` de
// `services/api/routeur.mjs`) ; la route de la console la transmet
// (`app/api/v1/spa-loads/route.ts`, `lib/api/service-seul.ts`) et n'exécute jamais ce
// module : la console n'y gagne aucune lecture de base.
//
// Les changements d'écran d'une application monopage, par route d'ARRIVÉE : nombre,
// `SPA_LOAD` p50/p75 (ms, jusqu'au calme du DOM et du réseau). Lecture :
// `chargementsSpaParRoute` (`lib/queries-engagement.ts`), celle de l'écran /pages.
import { chargementsSpaParRoute } from "../../queries-engagement";
import { handle } from "../handle";
import { parsePagination } from "../pagination";
import { preflight } from "../respond";
import { SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX } from "../signaux-vue";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const { limit } = parsePagination(searchParams, SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX);
  return chargementsSpaParRoute(filters.legacy, limit);
});
