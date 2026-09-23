// Pool Postgres d'un service, réglé une fois pour toutes.
//
// ZÉRO DÉPENDANCE : `pg` est PASSÉ EN PARAMÈTRE (`createPool(pg, …)`). Le kit
// ne l'importe pas, pour deux raisons. Le service `mcp` utilise le kit et ne
// doit PAS pouvoir atteindre la base (pas de `pg` dans son image, c'est sa
// seule protection contre une injection de prompt) ; et la version de `pg`
// reste celle que fige le manifeste du service, pas une deuxième copie.
//
// Ce que chaque réglage évite :
//   - `pool.on('error')` : un client INACTIF coupé par le pooler Neon, un
//     redémarrage de la base ou un `pg_terminate_backend` émet 'error' sur le
//     pool. Sans écouteur, Node le traite en exception non capturée : le
//     processus meurt sur un événement parfaitement bénin — le pool aurait
//     simplement ouvert une nouvelle connexion à la requête suivante.
//     (`packages/backend/lib/serveur.mjs:creerPool` n'en pose pas : c'est le
//     défaut vivant relevé par le plan.)
//   - un écouteur 'error' sur chaque client EMPRUNTÉ. `pool.on('error')` ne
//     couvre que les clients au repos : au prêt (`pool.connect()`), pg-pool
//     RETIRE son propre écouteur du client. Un `pg_terminate_backend` qui
//     tombe pendant un emprunt — une transaction qui attend un webhook dans le
//     dispatcher, une étape planifiée — fait alors émettre 'error' à un client
//     sans écouteur : exception non capturée, processus arrêté. La requête en
//     cours échoue de toute façon, et pg-pool écarte le client à sa
//     restitution ; l'écouteur ne fait que TRACER. Posé sur l'événement
//     'connect' (une fois par connexion), il n'envoie rien au serveur.
//   - `connectionTimeoutMillis` : sans lui, `pool.connect()` attend
//     indéfiniment une base qui ne répond pas, et la requête HTTP avec.
//   - `idleTimeoutMillis` : rend au pooler les connexions qui ne servent plus.
//     Sur Neon, une connexion est une ressource comptée (`max_connections` = 112
//     au relevé du 23/09/2026), partagée par tous les services.
//   - `query_timeout` : borne CÔTÉ CLIENT. Elle vaut aussi quand le réseau
//     avale la réponse, là où `statement_timeout` (côté serveur) ne voit rien.
//   - `application_name` : qui est connecté, lisible dans `pg_stat_activity`.
//     Tous les services se connectent avec le même rôle propriétaire ; sans
//     nom, leurs connexions sont indiscernables. Le nom traverse le pooler
//     (vérifié pour la console, commit 98125dd).
//
// AUCUN `SET` DE SESSION, ni ici, ni sur l'événement 'connect'. En production
// la connexion passe par le pooler Neon en mode TRANSACTION : un `SET` est pris
// sur un backend et perdu au suivant — ou, pire, laissé à la requête d'un
// autre. C'est exactement ce qui a cassé le verrou de session du scheduler
// (voir `@mip/backend/jobs/bail.mjs`). Un délai par étape se pose DANS la
// transaction : `select set_config('statement_timeout', '30s', true)`. Et pas
// de `statement_timeout` en paramètre de démarrage non plus : le pooler n'en
// garantit pas la transmission.

/**
 * Faut-il chiffrer la connexion Postgres, et comment ?
 *
 * SÛR PAR DÉFAUT, mais pas au point de casser un déploiement auto-hébergé.
 * L'heuristique « TLS sauf si l'hôte est localhost » ne suffit pas : en
 * docker-compose l'hôte s'appelle `db`, et exiger TLS d'un Postgres de
 * conteneur donne « The server does not support SSL connections ».
 *
 * L'ordre de décision :
 *   1. `sslmode` dans l'URL, ou PGSSLMODE : c'est le réglage standard, il fait
 *      autorité. `require`/`verify-ca`/`verify-full` chiffrent ; `disable`,
 *      `allow` et `prefer` laissent faire le pilote.
 *   2. Sinon, chiffrer SAUF si l'hôte ne peut pas être public : loopback, ou
 *      un nom SANS POINT (service de compose, de Kubernetes, alias
 *      /etc/hosts). La règle ne peut donc pas déchiffrer une connexion vers
 *      l'extérieur.
 *
 * Ne JAMAIS renvoyer `rejectUnauthorized: false` : ce serait une interception
 * silencieuse. (Reprise telle quelle de `@mip/backend/lib/serveur.mjs`, qui la
 * réexporte désormais : une seule décision TLS pour tout le dépôt.)
 *
 * @param {string} connectionString
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
    return ["require", "verify-ca", "verify-full"].includes(mode) ? { rejectUnauthorized: true } : undefined;
  }

  const prive = hote === "localhost" || hote === "127.0.0.1" || hote === "::1" || !hote.includes(".");
  return prive ? undefined : { rejectUnauthorized: true };
}

/** Cible de connexion sans le mot de passe — pour les journaux. */
export function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    return { host: u.host, database: u.pathname.replace(/^\//, "") || "(défaut)", user: u.username || "(défaut)" };
  } catch {
    // Surtout pas la chaîne brute : elle contient le mot de passe.
    return { host: "(chaîne de connexion non parsable)" };
  }
}

/**
 * `application_name` tel que Postgres le gardera : ASCII imprimable, 63
 * caractères au plus (au-delà, le serveur tronque en silence).
 */
function nomApplication(nom) {
  return String(nom).replace(/[^\x20-\x7e]/g, "_").slice(0, 63);
}

/**
 * @typedef {object} PoolOptions
 * @property {string} connectionString   obligatoire : pas de repli sur un Postgres local
 * @property {string} applicationName    nom lu dans pg_stat_activity (ex. « mip-scheduler »)
 * @property {number} [max]              taille du pool (défaut 5)
 * @property {number} [connectionTimeoutMillis]  attente d'une connexion (défaut 5 s)
 * @property {number} [idleTimeoutMillis]        fermeture d'une connexion inactive (défaut 30 s)
 * @property {number} [queryTimeoutMillis]       `query_timeout` côté client (défaut 30 s)
 * @property {number} [maxLifetimeSeconds]       recyclage des connexions (défaut : aucun)
 * @property {object} [ssl]                      défaut : `optionsSsl(connectionString)`
 * @property {import("./log.mjs").Logger} [log]
 * @property {ReturnType<import("./metrics.mjs").createMetrics>} [metrics]
 * @property {ReturnType<import("./lifecycle.mjs").installLifecycle>} [lifecycle]
 *   si fourni, `pool.end()` est enregistré en phase de fermeture — APRÈS le
 *   drainage des requêtes et des boucles. Ne pas appeler `pool.end()` soi-même
 *   en plus : `pg` lève au second appel.
 */

/**
 * @param {{ Pool: new (config: object) => any }} pg  le module `pg` du service
 * @param {PoolOptions} options
 */
export function createPool(pg, options) {
  if (!pg || typeof pg.Pool !== "function") throw new TypeError("createPool : passer le module `pg` (import pg from \"pg\")");
  const {
    connectionString,
    applicationName,
    max = 5,
    connectionTimeoutMillis = 5_000,
    idleTimeoutMillis = 30_000,
    queryTimeoutMillis = 30_000,
    maxLifetimeSeconds,
    log,
    metrics,
    lifecycle,
  } = options ?? {};
  // Pas de repli sur `postgres://localhost` : c'est le piège de `creerPool`,
  // qu'un DATABASE_URL oublié transformait en service « vivant » qui écrit
  // dans le vide. La configuration (`defineConfig`) a déjà refusé de démarrer.
  if (!connectionString) throw new TypeError("createPool : connectionString obligatoire");
  if (!applicationName) throw new TypeError("createPool : applicationName obligatoire (lisible dans pg_stat_activity)");

  const config = {
    connectionString,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    application_name: nomApplication(applicationName),
    // Keepalive TCP : une connexion morte derrière un NAT est détectée par le
    // noyau au lieu de pendre jusqu'au délai de requête.
    keepAlive: true,
    ssl: "ssl" in (options ?? {}) ? options.ssl : optionsSsl(connectionString),
  };
  if (maxLifetimeSeconds) config.maxLifetimeSeconds = maxLifetimeSeconds;

  const pool = new pg.Pool(config);

  const erreurs = metrics?.counter("pg_pool_errors_total", "Erreurs émises par le pool hors requête (client inactif coupé).");
  pool.on("error", (err) => {
    // Rien à relancer : le pool a déjà écarté le client fautif et en ouvrira
    // un autre à la demande. On TRACE, et c'est tout.
    erreurs?.inc();
    log?.warn("pg : connexion inactive perdue — le pool la remplacera", { err });
  });

  // Clients prêtés en ce moment : au repos, c'est l'écouteur du pool (ci-dessus)
  // qui trace ; une seule ligne par coupure.
  const empruntes = new WeakSet();
  pool.on("acquire", (client) => empruntes.add(client));
  pool.on("release", (_err, client) => empruntes.delete(client));
  pool.on("connect", (client) => {
    client.on?.("error", (err) => {
      if (!empruntes.has(client)) return;
      erreurs?.inc();
      log?.warn("pg : connexion empruntée coupée — la requête en cours échoue, le client sera écarté", { err });
    });
  });

  if (metrics) {
    metrics.gauge("pg_pool_connections", "Connexions du pool, par état.", {
      labels: ["state"],
      collect: () => [
        { labels: { state: "total" }, value: pool.totalCount ?? 0 },
        { labels: { state: "idle" }, value: pool.idleCount ?? 0 },
        { labels: { state: "waiting" }, value: pool.waitingCount ?? 0 },
      ],
    });
  }

  if (lifecycle) {
    let fin = null;
    // Idempotent : `pg` lève « Called end on pool more than once ».
    lifecycle.onClose("pg", () => (fin ??= pool.end()));
  }

  return pool;
}

/**
 * La base répond-elle ? `select 1`, borné par `timeoutMs` QUOI QU'IL ARRIVE :
 * la course contre la minuterie couvre aussi l'attente d'une connexion libre.
 * Lève si non. C'est la moitié « base joignable » de /health.
 *
 * @param {{ query: Function }} pool
 * @param {{ timeoutMs?: number }} [options]
 */
export async function ping(pool, { timeoutMs = 2_000 } = {}) {
  const requete = pool.query({ text: "select 1", query_timeout: timeoutMs });
  // Si la minuterie gagne, la requête perdante finira par échouer ou réussir
  // SANS personne pour l'attendre : sans ce `catch`, son rejet deviendrait un
  // `unhandledRejection` — et la garde de `lifecycle.mjs` arrêterait le
  // processus pour une sonde lente.
  requete.catch(() => {});
  let minuterie;
  const delai = new Promise((_, rejeter) => {
    minuterie = setTimeout(() => rejeter(new Error(`base : pas de réponse en ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([requete, delai]);
  } finally {
    clearTimeout(minuterie);
  }
}
