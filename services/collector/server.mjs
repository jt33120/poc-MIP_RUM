// Service « collector » — le point d'entrée unique de ce que poussent les capteurs.
//
// CÂBLAGE SEUL. Le receveur (routes, clés, débit, CORS, bord de confiance,
// identité, budget de requête) vit dans `@mip/backend/lib/receiver.mjs`,
// partagé avec les serveurs de développement ; le processus (configuration,
// arrêt propre, pool, sondes, boucle) dans `@mip/service-kit`. Détail des
// routes, des sondes et des modes de panne : `services/collector/README.md`.
//
// Les quatre signaux tiennent dans UN service : ils écrivent dans la même base,
// partagent le registre d'apps, la vérification de clé et le compteur de débit.
// Le jour où le replay mérite son propre profil de charge, la découpe se fait
// ici, en changeant `signaux`.
import pg from "pg";
import { COMMON_ENV, defineConfig } from "@mip/service-kit/config.mjs";
import { createLogger } from "@mip/service-kit/log.mjs";
import { installLifecycle } from "@mip/service-kit/lifecycle.mjs";
import { createPool, describeTarget } from "@mip/service-kit/pg.mjs";
import { createMetrics } from "@mip/service-kit/metrics.mjs";
import { startService } from "@mip/service-kit/http.mjs";
import { startLoop } from "@mip/service-kit/loop.mjs";
import { BUDGET_REQUETE, creerReceveur, plafondCorps } from "@mip/backend/lib/receiver.mjs";
import { drainerIngestRaw } from "@mip/backend/lib/ingest-differe.mjs";
import { IDENTITY_FINGERPRINT_PATTERN, verifierConfigIdentite } from "@mip/backend/lib/identity-hash.mjs";
import { parseSourceIp, verifierSecretsBord } from "@mip/backend/shared/client-ip.mjs";

const log = createLogger("collector");

// AVANT TOUT `await` : un SIGTERM reçu pendant le démarrage doit trouver son
// gestionnaire (même règle que le scheduler).
const lifecycle = installLifecycle({ log });

const config = defineConfig(
  {
    ...COMMON_ENV,
    // 4318 : le port OTLP/HTTP standard, et celui du compose et de l'image.
    PORT: { ...COMMON_ENV.PORT, default: 4318 },
    // Obligatoire, SANS repli : un DATABASE_URL oublié donnait un receveur qui
    // répondait 200 aux beacons et perdait tout en silence.
    DATABASE_URL: { type: "url", required: true, secret: true, protocols: ["postgres:", "postgresql:"], description: "Postgres (pooler Neon en production)." },
    PGPOOL_MAX: { type: "int", default: 8, min: 2, max: 20, description: "Taille du pool, par réplique. Neon plafonne à max_connections = 112 pour tous les services." },
    REQUIRE_API_KEY: { type: "bool", default: false, description: "true : toute app inconnue, inactive ou sans clé prend 403. Provisionner d'abord (scripts/ops/provisionner-cles.mjs)." },
    RATE_LIMIT_PER_MIN: { type: "int", default: 600, min: 1, description: "Plafond de requêtes par app et par minute (compteur durable en base)." },
    INGEST_DEFERRED: { type: "bool", default: false, description: "Acquitte avant d'écrire (table UNLOGGED, perdue à l'arrêt brutal de Postgres). Éteint par défaut." },
    INGEST_DRAIN_MS: { type: "int", default: 250, min: 50, max: 60_000, description: "Intervalle du drain de la file différée." },
    // Le secret SANS son empreinte est refusé dans la MÊME liste d'erreurs que
    // le reste (un déploiement par variable manquante, c'est ce que le kit évite).
    IDENTITY_HASH_SECRET: {
      type: "string", secret: true, minLength: 32,
      validate: (secret) => verifierConfigIdentite({ secret, empreinte: process.env.IDENTITY_HASH_FINGERPRINT?.trim() }),
      description: "Clé HMAC des identités. Absente : l'identité est retirée, jamais stockée brute.",
    },
    IDENTITY_HASH_FINGERPRINT: { type: "string", pattern: IDENTITY_FINGERPRINT_PATTERN, description: "Empreinte du secret (scripts/ops/empreinte-identite.mjs). Obligatoire avec le secret ; écart : readiness refusée." },
    EDGE_PROXY_SECRET: { type: "list", secret: true, validate: verifierSecretsBord, description: "Secret du relais de la console (x-mip-edge-auth) ; deux valeurs séparées par une virgule pendant une rotation." },
    GEOIP_IP_SOURCE: { type: "string", default: "none", validate: (v) => (parseSourceIp(v).mode === "invalide" ? "attendu : none, socket, railway ou xff:<n>" : null), description: "D'où lire l'adresse du trafic DIRECT pour le GeoIP." },
  },
  { service: "collector", log },
);

const metrics = createMetrics();
const pool = createPool(pg, {
  connectionString: config.DATABASE_URL,
  applicationName: "mip-collector",
  max: config.PGPOOL_MAX,
  // Sous le budget de requête (≈ 4 s) : attendre 5 s une connexion ferait
  // répondre le collector APRÈS le délai du relais de la console.
  connectionTimeoutMillis: 2_000,
  // `query_timeout` AU BUDGET (4 s, pas les 30 s du kit). L'ingestion est déjà
  // bornée par son échéance ; ceci borne le RESTE (source maps, /ready, drain,
  // la requête de garde abandonnée qui finit seule) : aucune requête ne tient
  // une connexion du pool au-delà de ce que le relais attendra.
  queryTimeoutMillis: BUDGET_REQUETE.totalMs,
  log,
  metrics,
  lifecycle,
});

const receveur = creerReceveur(pool, {
  log,
  nom: "collector",
  // /__recent retient des payloads en clair : jamais ici (et le receveur
  // refuserait de démarrer avec, sous NODE_ENV=production).
  tampon: false,
  signaux: ["traces", "logs", "replay", "sourcemaps"],
  requireApiKey: config.REQUIRE_API_KEY,
  rateLimitPerMin: config.RATE_LIMIT_PER_MIN,
  differe: config.INGEST_DEFERRED,
  identityHashSecret: config.IDENTITY_HASH_SECRET,
  identityFingerprint: config.IDENTITY_HASH_FINGERPRINT,
  edgeSecrets: config.EDGE_PROXY_SECRET,
  sourceIp: parseSourceIp(config.GEOIP_IP_SOURCE),
});

// LE DRAIN VIT ICI, ET PAS DANS LE SCHEDULER : la file différée est une affaire
// de centaines de millisecondes, pas de cinq minutes. La boucle du kit ne
// lance jamais deux passages de front, et au SIGTERM finit le sien avant que
// le pool ne ferme. `keepAlive: false` : c'est le serveur qui tient le
// processus en vie, pas le drain. Un échec (base coupée) n'arrête pas la boucle.
if (config.INGEST_DEFERRED) {
  startLoop({
    name: "drain",
    intervalMs: config.INGEST_DRAIN_MS,
    keepAlive: false,
    log,
    metrics,
    lifecycle,
    run: async () => {
      const { drains, echecs } = await drainerIngestRaw(pool, { max: 200, log });
      if (echecs) log.warn("drain: lots en échec", { drains, echecs });
    },
  });
}

startService({
  name: "collector",
  port: config.PORT,
  log,
  pool,
  metrics,
  metricsToken: config.METRICS_TOKEN,
  lifecycle,
  handler: receveur.handler,
  // Borne EXTÉRIEURE, au double de celle du receveur : c'est lui qui répond 413
  // en premier, AVEC ses en-têtes CORS (un 413 sans CORS devient, côté
  // navigateur, une erreur réseau illisible). Le kit n'est qu'un filet.
  maxBodyBytes: (req) => 2 * plafondCorps(req.url),
  // /health publique : statut du kit + ce que l'opérateur doit lire d'un coup
  // d'œil (service, protocole de bord, état et empreinte de l'identité, GeoIP).
  details: receveur.infosSante,
  // /ready (jeton) : registre d'apps chargé au moins une fois, identité concordante.
  ready: receveur.pret,
});

log.info("collector démarré", {
  db: describeTarget(config.DATABASE_URL),
  require_api_key: config.REQUIRE_API_KEY,
  rate_per_min: config.RATE_LIMIT_PER_MIN,
  // Un opérateur doit pouvoir lire si ce déploiement acquitte avant d'avoir écrit.
  ingest_deferred: config.INGEST_DEFERRED,
  identity: receveur.identite.etat,
  id_fp: receveur.identite.id_fp,
  edge_trust: Boolean(config.EDGE_PROXY_SECRET?.length),
});
