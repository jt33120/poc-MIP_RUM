// Démarrage et arrêt propres d'un service HTTP Node.
//
// Extrait parce que les trois points d'entrée (service Railway, dev-server,
// replay-dev-server) doivent se comporter pareil au redéploiement : cesser
// d'accepter, laisser finir les requêtes en vol, fermer le pool. Sans ça,
// chaque déploiement laisse des connexions Postgres orphelines — et sur Neon
// les connexions sont une ressource comptée, pas un détail.
import http from "node:http";
import { optionsSsl } from "@mip/service-kit/pg.mjs";

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
 * Faut-il chiffrer la connexion Postgres, et comment ? La décision (sûre par
 * défaut, jamais `rejectUnauthorized: false`) vit dans `@mip/service-kit/pg.mjs`
 * avec sa justification ; ce module la RÉEXPORTE pour ses appelants actuels
 * (`creerPool` ci-dessous, la console via `lib/db.ts`, les tests). Une seule
 * décision TLS pour tout le dépôt : deux copies d'une règle de sécurité
 * finissent toujours par diverger.
 */
export { optionsSsl };

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
