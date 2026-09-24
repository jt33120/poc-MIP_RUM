// `apps/console/lib/db.ts` DANS LE SERVICE `console-api` : le pool du service, nommé
// `mip-console-api`, créé par le kit et INJECTÉ par `server.mjs`.
//
// Même interface que la console (`pool`, `q`, `tx`, `withTenant`) : le code des
// lectures est celui de la console, à l'octet près. Ce qui change est le pool —
// celui du kit (délais, écouteur d'erreur, `application_name`, drainage au
// SIGTERM) au lieu d'un `new Pool` au chargement du module. Il est paresseux :
// évaluer ce module ne se connecte à rien, et une `DATABASE_URL` absente est
// refusée par la configuration du service, en clair, avant toute requête.

/** @type {import("pg").Pool | null} */
let courant = null;

/** Branche le pool du service. Appelé une fois, par `server.mjs`. */
export function brancherPool(pool) {
  courant = pool;
}

function obtenir() {
  if (!courant) throw new Error("console-api : pool non branché (server.mjs doit appeler brancherPool)");
  return courant;
}

/** Façade du pool, pour le code qui l'importe directement. */
export const pool = {
  query: (...a) => obtenir().query(...a),
  connect: (...a) => obtenir().connect(...a),
  on: (...a) => obtenir().on(...a),
  end: () => courant?.end(),
};

/**
 * @template T
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<T[]>}
 */
export async function q(text, params) {
  const { rows } = await obtenir().query(text, params);
  return rows;
}

/** Transaction atomique : begin → fn(client) → commit ; rollback sur erreur. */
export async function tx(fn) {
  const client = await obtenir().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * La portée tenant posée en base, comme dans la console (`set_config(…, true)`,
 * jamais un SET de session : le pooler Neon le perdrait ou le laisserait au voisin).
 */
export async function withTenant(appIds, fn) {
  const portee = (Array.isArray(appIds) ? appIds : [appIds]).filter(Boolean);
  if (portee.length === 0) throw new Error("withTenant: portée tenant vide");
  const fautif = portee.find((id) => id.includes(","));
  if (fautif) throw new Error(`withTenant: app_id invalide (virgule) : ${fautif}`);
  return tx(async (client) => {
    await client.query("select set_config('app.current_app_id', $1, true)", [portee.join(",")]);
    return fn(client);
  });
}
