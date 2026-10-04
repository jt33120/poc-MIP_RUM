// GET /api/v1/engagement — SERVIE PAR LE SERVICE `api` SEUL (`ROUTES_SERVICE_SEUL` de
// `services/api/routeur.mjs`) ; la route de la console la transmet
// (`app/api/v1/engagement/route.ts`, `lib/api/service-seul.ts`) et n'exécute jamais ce
// module : la console n'y gagne aucune lecture de base.
//
// L'engagement par route, tel que l'écran /pages le montre : temps passé visible
// (`TIME_SPENT`) p50/p75, défilement maximal (`SCROLL_DEPTH`) p50 et part des vues
// profondes. Lecture : `engagementParRoute` (`lib/queries-engagement.ts`). Sous 13
// mesures, une valeur vaut `null` et `manque` dit ce qui manque — jamais 0.
import { engagementParRoute } from "../../queries-engagement";
import { handle } from "../handle";
import { parsePagination } from "../pagination";
import { preflight } from "../respond";
import { SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX } from "../signaux-vue";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const { limit } = parsePagination(searchParams, SIGNAUX_VUE_DEFAUT, SIGNAUX_VUE_MAX);
  return engagementParRoute(filters.legacy, limit);
});
