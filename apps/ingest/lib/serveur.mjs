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
 * Pool Postgres d'un service backend.
 *
 * TLS : une base locale (docker-compose) n'en a pas ; toute base distante en
 * exige un, vérifié contre le magasin CA système. Le certificat Neon chaîne à
 * une autorité publique — rien à épingler. Ne JAMAIS remplacer par
 * `rejectUnauthorized: false` : ça rendrait l'interception silencieuse.
 */
export function creerPool(pg, { max = 5 } = {}) {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum";
  const local = /:\/\/[^/]*(localhost|127\.0\.0\.1)([:/]|$)/.test(connectionString);
  return new pg.Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? max),
    ssl: local ? undefined : { rejectUnauthorized: true },
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
