// Contexte d'exécution : « de quelle requête, de quel tour de boucle cette ligne
// de journal fait-elle partie ? ».
//
// POURQUOI AsyncLocalStorage ET PAS UN LOGGER PASSÉ EN PARAMÈTRE. Le noyau crée
// ses loggers au niveau du module (`const log = createLogger("ingest")`) et les
// appelle à vingt niveaux de profondeur. Faire descendre un logger enfant
// jusque-là réécrirait toutes les signatures du pipeline ; le contexte
// asynchrone, lui, suit la chaîne des `await` sans que personne n'ait à le
// porter. `http.mjs` y range `request_id`, `loop.mjs` y range `run_id`, et
// chaque ligne émise pendant ce temps les porte.
//
// Ce fichier BRANCHE le fournisseur de `log.mjs` à son import. `log.mjs` ne
// peut pas le faire lui-même : il reste sans import `node:` pour rester
// importable par la console Next.
import { AsyncLocalStorage } from "node:async_hooks";
import { setLogContextProvider } from "./log.mjs";

const stockage = new AsyncLocalStorage();

setLogContextProvider(() => stockage.getStore());

/**
 * Exécute `fn` avec des champs de contexte, fusionnés à ceux du contexte
 * englobant (un tour de boucle qui fait une requête garde son `run_id`).
 * @template T
 * @param {Record<string, unknown>} champs
 * @param {() => T} fn
 * @returns {T}
 */
export function withContext(champs, fn) {
  const parent = stockage.getStore();
  return stockage.run(Object.freeze({ ...(parent ?? {}), ...champs }), fn);
}

/** Champs du contexte courant, ou `undefined` hors de tout contexte. */
export function currentContext() {
  return stockage.getStore();
}
