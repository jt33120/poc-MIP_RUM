// `apps/console/lib/log-forward.ts` DANS LE SERVICE `console-api` : le renvoi des
// erreurs vers l'ingestion de logs de la console devient une ligne du journal
// structuré du service (lue dans Railway), avec son `request_id` — celui de
// l'appel en cours, posé par `avecRequete` autour de chaque chargeur d'écran.
import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "@mip/service-kit/log.mjs";

const log = createLogger("console-api");
/** @type {AsyncLocalStorage<{ requestId: string }>} */
const requete = new AsyncLocalStorage();

/**
 * Exécute `fn` en lui rattachant l'identifiant de requête : une section en échec
 * pendant `fn` se journalise avec lui, même après la réponse (`after`).
 * @template T
 * @param {string} requestId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function avecRequete(requestId, fn) {
  return requete.run({ requestId }, fn);
}

/**
 * @param {"info"|"warn"|"error"} niveau
 * @param {string} message
 * @param {Record<string, unknown>} [champs]
 */
export async function forwardLog(niveau, message, champs = {}) {
  const courante = requete.getStore();
  (log[niveau] ?? log.error)("journal des chargeurs", { message, ...champs, ...(courante ? { request_id: courante.requestId } : {}) });
}
