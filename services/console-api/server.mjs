// Service « console-api » — le backend de la console (piste C du plan backend).
//
// CÂBLAGE SEUL. La logique vit dans `@mip/console-api` : le pipeline de sécurité
// (secret client, refus des navigateurs, session, démo, rôle, portée, entrée,
// débit, échéance), la table des opérations et leurs traitements. Ici : la
// configuration refusée en bloc, le pool, les clés, et le processus du kit
// (sondes, arrêt propre, métriques, journal d'accès).
//
// SEUL CLIENT : le serveur de la console, sur Vercel. Il s'annonce par le secret
// client (`x-mip-client`), jamais un navigateur (un `Origin` est refusé). Vercel
// ne rejoint pas le réseau privé Railway : le domaine généré est public, gardé
// par ce secret — sans lui, tout répond 404. Avant de l'envoyer, la console
// vérifie l'hôte par la poignée de main signée (`GET /v1/version?nonce=`).
//
// LES SONDES : /health (processus + base, la sonde Railway), /live, /ready et
// /metrics sous METRICS_TOKEN — servies par le kit, sans secret client.
import pg from "pg";
import { COMMON_ENV, defineConfig } from "@mip/service-kit/config.mjs";
import { createLogger } from "@mip/service-kit/log.mjs";
import { installLifecycle } from "@mip/service-kit/lifecycle.mjs";
import { createPool, describeTarget } from "@mip/service-kit/pg.mjs";
import { createMetrics } from "@mip/service-kit/metrics.mjs";
import { startService } from "@mip/service-kit/http.mjs";
import { chargerTrousseau, creerConsoleApi, creerTable, creerVerificateurSession } from "@mip/console-api";

const log = createLogger("console-api");
const lifecycle = installLifecycle({ log });

const config = defineConfig(
  {
    ...COMMON_ENV,
    DATABASE_URL: {
      type: "url",
      required: true,
      secret: true,
      protocols: ["postgres:", "postgresql:"],
      description: "Postgres. Rôle propriétaire jusqu'à C13 (puis mip_console et mip_identity).",
    },
    PGPOOL_MAX: { type: "int", default: 8, min: 2, max: 30, description: "Taille du pool, par réplique." },
    CONSOLE_API_CLIENT_SECRETS: {
      type: "list",
      required: true,
      secret: true,
      description: "Le secret client de la console : une valeur, ou `nouvelle,ancienne` pendant une rotation (32 caractères au moins).",
      validate: (l) => (l.length < 1 || l.length > 2 ? "1 ou 2 valeurs" : l.some((s) => s.length < 32) ? "32 caractères au moins par valeur" : undefined),
    },
    SESSION_SIGNING_KEYS: {
      type: "string",
      required: true,
      secret: true,
      description: "Jeu JWKS PRIVÉ ES256, 1 ou 2 clés (la première signe) : `node scripts/ops/generer-cles-session.mjs --nouvelle`.",
    },
    CONSOLE_API_RATE_LIMIT: {
      type: "int",
      default: 600,
      min: 0,
      max: 100_000,
      description: "Appels par minute et par principal, par réplique (0 = sans limite). La console rejoue ses écrans toutes les 5 s.",
    },
    RAILWAY_GIT_COMMIT_SHA: { type: "string", description: "Posée par Railway : la version qu'annonce la poignée de main." },
    RAILWAY_ENVIRONMENT: { type: "string", description: "Posée par Railway : en sa présence, une clé de test est refusée." },
  },
  { service: "console-api", log },
);

// Une clé dont le `kid` dit « test » ou « dev » est refusée hors poste de travail :
// c'est celle d'un jeu qui a circulé (tests, doc, fumée).
const production = Boolean(config.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production";
let trousseau;
try {
  trousseau = await chargerTrousseau(config.SESSION_SIGNING_KEYS, { production });
} catch (err) {
  log.error("refus de démarrer", { raison: err.message });
  process.exit(2);
}

const metrics = createMetrics();
const pool = createPool(pg, {
  connectionString: config.DATABASE_URL,
  applicationName: "mip-console-api",
  max: config.PGPOOL_MAX,
  log,
  metrics,
  lifecycle,
});

const version = (config.RAILWAY_GIT_COMMIT_SHA ?? "dev").slice(0, 12);
const { table, contrat } = await creerTable({ trousseau, version, db: pool });

const requetes = metrics.counter("console_api_requests_total", "Appels de la console, par opération et par statut.", {
  labels: ["operation", "status"],
});

// Les sessions : signature ES256 PUIS ligne `console_session` (migration-v90),
// jointe au compte, en cache 30 s par réplique — le délai maximal d'une révocation.
const sessions = await creerVerificateurSession({ trousseau, db: pool });

const servir = creerConsoleApi({
  table,
  secretsClient: config.CONSOLE_API_CLIENT_SECRETS,
  verifierSession: sessions.verifier,
  lecteur: pool,
  journal: log,
  debitParMinute: config.CONSOLE_API_RATE_LIMIT,
  surReponse: ({ operation, statut }) => requetes.inc({ operation, status: String(statut) }),
});

startService({
  name: "console-api",
  port: config.PORT,
  log,
  pool,
  metrics,
  metricsToken: config.METRICS_TOKEN,
  lifecycle,
  // Plafond du SERVEUR ; chaque opération a le sien, plus bas (64 Kio par défaut).
  maxBodyBytes: 1024 * 1024,
  fetch: servir,
});

log.info("console-api démarré", {
  db: describeTarget(config.DATABASE_URL),
  operations: table.length,
  contrat: contrat.slice(0, 12),
  kid: trousseau.courante.kid,
  cles: trousseau.toutes.length,
  secrets_client: config.CONSOLE_API_CLIENT_SECRETS.length,
});
