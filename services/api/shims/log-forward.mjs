// `apps/console/lib/log-forward.ts` DANS LE SERVICE `api`.
//
// La console renvoie ses erreurs serveur vers sa propre ingestion de logs (la page
// /logs de la console se supervise elle-même). Le service `api` a son journal
// structuré — une ligne JSON par événement, lue dans Railway —, et poster vers
// l'ingestion depuis ici réveillerait une chaîne de plus pour rien. Le renvoi
// devient une ligne de journal.
import { createLogger } from "@mip/service-kit/log.mjs";

const log = createLogger("api");

/**
 * @param {"info"|"warn"|"error"} niveau
 * @param {string} message
 * @param {Record<string, unknown>} [champs]
 */
export async function forwardLog(niveau, message, champs = {}) {
  (log[niveau] ?? log.error)("journal de l'API v1", { message, ...champs });
}
