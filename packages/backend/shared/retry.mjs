// Retry à backoff exponentiel + jitter — runtime-agnostic (Node + Deno).
//
// Pourquoi : l'ingestion écrit dans Postgres derrière un pooler. Un pic de
// charge, un failover ou un recyclage de connexion produit des erreurs
// *transitoires* : les rejouer après quelques ms réussit, alors qu'un 5xx
// renvoyé au client perd la donnée (le beacon navigateur ne réémet pas). On
// ne rejoue QUE les erreurs transitoires ; une faute de schéma/contrainte
// (déterministe) remonte immédiatement, sans gaspiller de tentatives.

// Codes Postgres (SQLSTATE) + erreurs réseau Node considérés transitoires.
const TRANSIENT = new Set([
  // réseau / socket
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN",
  // classe 08 — connection exception
  "08000", "08003", "08006", "08001", "08004", "08007",
  // 53300 too_many_connections, 53400 configuration_limit_exceeded
  "53300", "53400",
  // 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now
  "57P01", "57P02", "57P03",
  // 40001 serialization_failure, 40P01 deadlock_detected
  "40001", "40P01",
]);

/** Heuristique : l'erreur vaut-elle un nouvel essai ? (code SQLSTATE ou errno). */
export function isTransient(err) {
  const code = err?.code ?? err?.cause?.code ?? err?.originalError?.code;
  return code != null && TRANSIENT.has(String(code));
}

/**
 * Une panne de base qui vaut « rejoue plus tard » — ce que les ports
 * d'ingestion rendent en 503 + `retry-after`, jamais en 500 : erreur
 * transitoire connue, délai du pool (`pg-pool` lève une erreur SANS code quand
 * il n'obtient pas de connexion à temps), délai de requête côté client.
 *
 * POURQUOI ICI. Elle vivait dans le receveur du collector seul : la même base
 * injoignable rendait 503 sur le collector et 500 sur la console. Le SDK rejoue
 * les deux, mais seul le 503 porte le `retry-after` qui étale les rejeux — et
 * pendant la bascule de P3, une requête peut tomber sur l'un OU l'autre port.
 * Relevé par le contrat de parité (`tests/contract/ingest-parity.test.ts`).
 */
export function estIndisponibilite(err) {
  if (isTransient(err)) return true;
  const m = String(err?.message ?? "");
  return /timeout exceeded when trying to connect|Query read timeout|Connection terminated/i.test(m);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Exécute `fn` avec retries à backoff exponentiel borné + jitter.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{retries?:number, baseMs?:number, maxMs?:number,
 *          shouldRetry?:(e:unknown)=>boolean, onRetry?:(e:unknown,attempt:number,delay:number)=>void}} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseMs = 100,
    maxMs = 2000,
    shouldRetry = isTransient,
    onRetry,
  } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries || !shouldRetry(err)) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = backoff + Math.random() * backoff * 0.2; // jitter ±20 %
      try {
        onRetry?.(err, attempt, Math.round(delay));
      } catch {
        /* l'observabilité ne doit jamais casser le retry */
      }
      await sleep(delay);
    }
  }
}
