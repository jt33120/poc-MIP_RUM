// Démarrage et arrêt propres d'un service HTTP Node.
//
// Extrait parce que les trois points d'entrée (service Railway, dev-server,
// replay-dev-server) doivent se comporter pareil au redéploiement : cesser
// d'accepter, laisser finir les requêtes en vol, fermer le pool. Sans ça,
// chaque déploiement laisse des connexions Postgres orphelines — et sur Neon
// les connexions sont une ressource comptée, pas un détail.
import http from "node:http";

/**
 * @param {(req, res) => Promise<void>} handler
 * @param {{ port: number|string, pool?: import("pg").Pool, log?: object, nom?: string, infos?: object }} opts
 */
export function demarrerServeur(handler, opts) {
  const { port, pool, log = console, nom = "service", infos = {} } = opts;
  const serveur = http.createServer(handler);

  serveur.listen(port, () => log.info?.("listening", { service: nom, port: Number(port), ...infos }));

  let enArret = false;
  async function arreter(signal) {
    if (enArret) return;
    enArret = true;
    log.info?.("shutting down", { service: nom, signal });
    serveur.close(async () => {
      try {
        await pool?.end();
      } catch (err) {
        log.error?.("pool drain failed", { err: String(err) });
      }
      process.exit(0);
    });
    // Filet : on n'attend pas indéfiniment une connexion persistante. Railway
    // envoie SIGTERM puis SIGKILL ; mieux vaut sortir proprement avant.
    setTimeout(() => process.exit(0), 10_000).unref();
  }

  process.on("SIGTERM", () => arreter("SIGTERM"));
  process.on("SIGINT", () => arreter("SIGINT"));

  return { serveur, arreter };
}

/**
 * Faut-il chiffrer la connexion Postgres, et comment ?
 *
 * SÛR PAR DÉFAUT, mais pas au point de casser un déploiement auto-hébergé.
 * L'heuristique « TLS sauf si l'hôte est localhost » ne suffit pas : en
 * docker-compose l'hôte s'appelle `db`, et exiger TLS d'un Postgres de
 * conteneur donne « The server does not support SSL connections » — c'est
 * exactement ce qui a cassé le smoke-test du conteneur.
 *
 * L'ordre de décision :
 *   1. `sslmode` dans l'URL, ou PGSSLMODE : c'est le réglage standard, il fait
 *      autorité. `require`/`verify-ca`/`verify-full` chiffrent ; `disable`,
 *      `allow` et `prefer` laissent faire le pilote.
 *   2. Sinon, chiffrer SAUF si l'hôte ne peut pas être public : loopback, ou
 *      un nom SANS POINT. Un nom sans point n'est jamais un domaine public —
 *      c'est un service de compose, de Kubernetes, ou un alias /etc/hosts.
 *      La règle ne peut donc pas déchiffrer une connexion vers l'extérieur.
 *
 * Ne JAMAIS renvoyer `rejectUnauthorized: false` : ça rendrait une
 * interception silencieuse.
 *
 * @returns {undefined | {rejectUnauthorized: true}}
 */
export function optionsSsl(connectionString) {
  let hote = "";
  let modeUrl = null;
  try {
    const u = new URL(connectionString);
    hote = u.hostname;
    modeUrl = u.searchParams.get("sslmode");
  } catch {
    // Chaîne non parsable : on ne devine pas, on chiffre.
    return { rejectUnauthorized: true };
  }

  const mode = modeUrl ?? process.env.PGSSLMODE ?? null;
  if (mode) {
    return ["require", "verify-ca", "verify-full"].includes(mode)
      ? { rejectUnauthorized: true }
      : undefined;
  }

  const prive = hote === "localhost" || hote === "127.0.0.1" || hote === "::1" || !hote.includes(".");
  return prive ? undefined : { rejectUnauthorized: true };
}

/**
 * Pool Postgres d'un service backend. Le certificat Neon chaîne à une autorité
 * publique : rien à épingler, le magasin CA système suffit.
 */
export function creerPool(pg, { max = 5 } = {}) {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum";
  return new pg.Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? max),
    ssl: optionsSsl(connectionString),
  });
}

/** Cible de connexion sans le mot de passe — pour les journaux. */
export function cible(connectionString = process.env.DATABASE_URL ?? "") {
  try {
    const u = new URL(connectionString);
    return { host: u.host, database: u.pathname.replace(/^\//, "") || "(défaut)", user: u.username || "(défaut)" };
  } catch {
    return { host: "(chaîne de connexion non parsable)" };
  }
}
