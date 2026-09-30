// GET /api/v1/detections — SERVIE PAR LE SERVICE `api` SEUL (`ROUTES_SERVICE_SEUL` de
// `services/api/routeur.mjs`) ; la route de la console la transmet
// (`app/api/v1/detections/route.ts`, `lib/api/service-seul.ts`) et n'exécute jamais
// ce module : la console n'y gagne aucune lecture de base.
//
// Les épisodes détectés par calcul sur la période : une p75 horaire sortie de sa
// plage habituelle (travail `detections_horaires` du scheduler, table
// `signal_detecte`, v101), avec cette plage, l'heure qui a fait preuve et la
// phrase rédigée par règles. Les plus prioritaires d'abord.
//
// Un constat se lit par app, vital et route : ni l'appareil ni une dimension ne le
// découpent. Les demander est refusé (400 typé), jamais ignoré en silence.
import { constatsDeLaPeriode } from "../../queries-detections";
import { UnsupportedFilterError, unsupportedError } from "../../query-compiler";
import { conditionsOf } from "../../query-contract";
import { DETECTIONS_DEFAUT, DETECTIONS_MAX, detectionsDe } from "../detections";
import { handle } from "../handle";
import { parsePagination } from "../pagination";
import { preflight } from "../respond";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const condition = conditionsOf(filters.query.filters)[0];
  if (condition) {
    throw new UnsupportedFilterError(
      unsupportedError(
        condition.dimension,
        `les détections se lisent par application, vital et route : « ${condition.dimension} » ne les découpe pas`,
      ),
    );
  }
  const { limit } = parsePagination(searchParams, DETECTIONS_DEFAUT, DETECTIONS_MAX);
  return detectionsDe(await constatsDeLaPeriode(filters.query, limit), limit);
});
