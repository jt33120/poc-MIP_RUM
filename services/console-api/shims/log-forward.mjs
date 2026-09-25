// `apps/console/lib/log-forward.ts` DANS LE SERVICE `console-api` : le renvoi des
// erreurs vers l'ingestion de logs de la console devient une ligne du journal
// structuré du service (lue dans Railway), avec son `request_id`.
import { createLogger } from "@mip/service-kit/log.mjs";

const log = createLogger("console-api");

/**
 * @param {"info"|"warn"|"error"} niveau
 * @param {string} message
 * @param {Record<string, unknown>} [champs]
 */
export async function forwardLog(niveau, message, champs = {}) {
  (log[niveau] ?? log.error)("journal des chargeurs", { message, ...champs });
}
