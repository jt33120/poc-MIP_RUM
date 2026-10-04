// GET /api/v1/page-weight — SERVIE PAR LE SERVICE `api` SEUL (`ROUTES_SERVICE_SEUL` de
// `services/api/routeur.mjs`) ; la route de la console la transmet
// (`app/api/v1/page-weight/route.ts`, `lib/api/service-seul.ts`) et n'exécute jamais ce
// module : la console n'y gagne aucune lecture de base.
//
// Le poids des vues par route : ressources chargées par vue (`RESOURCE_COUNT`, p50) et
// octets transférés par vue (`RESOURCE_BYTES`, p75). Le SDK résume TOUTES les
// ressources de la vue, pas seulement les lentes qu'il envoie une à une. Lecture :
// `poidsDesVuesParRoute` (`lib/queries-engagement.ts`), celle de l'écran /pages.
import { poidsDesVuesParRoute } from "../../queries-engagement";
import { handle } from "../handle";
import { parsePagination } from "../pagination";
import { preflight } from "../respond";
import { SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX } from "../signaux-vue";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const { limit } = parsePagination(searchParams, SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX);
  return poidsDesVuesParRoute(filters.legacy, limit);
});
