// Service « notifier » — livre ce que la plateforme a décidé de dire (P5).
//
// CÂBLAGE SEUL. La passe de livraison vit dans `@mip/backend/jobs/livreur.mjs`
// (routage de l'outbox des issues, webhooks signés, e-mails Resend, tickets), le
// processus (configuration, arrêt propre, pool, sondes, boucles) dans
// `@mip/service-kit`.
//
//   livraison        toutes les 15 s (NOTIFIER_INTERVAL_MS)   outbox → webhooks, e-mails, tickets
//   reconciliation   toutes les heures                         livraisons `sent` de l'ère pg_net
//
// LE SEUL DÉTENTEUR DES SECRETS SORTANTS : la clé Resend, le secret de signature
// des webhooks, les jetons de tickets (`TICKET_SECRET_KEY`, `TICKET_*`). Le
// scheduler décide, le notifier écrit au monde ; ni Vercel ni le scheduler ne
// portent ces secrets.
//
// LA BASCULE (P5). Le scheduler livrait à chaque tick. On coupe sa livraison
// (`SCHEDULER_DELIVERY=off`) AVANT ou EN MÊME TEMPS que le notifier démarre : un
// scheduler sans clé Resend qui tomberait sur une livraison e-mail la solderait
// `skipped`. Les livraisons attendent `queued` le temps du démarrage ; rien ne se
// perd. Retour arrière : `SCHEDULER_DELIVERY=on`, notifier à 0.
//
// LES SONDES :
//   /health   processus vivant + base joignable. LA sonde Railway.
//   /ready    fraîcheur de la dernière passe aboutie et arriéré des livraisons,
//   /metrics  derrière METRICS_TOKEN — supervision seulement.
import pg from "pg";
import { COMMON_ENV, defineConfig } from "@mip/service-kit/config.mjs";
import { createLogger } from "@mip/service-kit/log.mjs";
import { installLifecycle } from "@mip/service-kit/lifecycle.mjs";
import { createPool, describeTarget } from "@mip/service-kit/pg.mjs";
import { createMetrics } from "@mip/service-kit/metrics.mjs";
import { startService } from "@mip/service-kit/http.mjs";
import { startLoop } from "@mip/service-kit/loop.mjs";
import { configEmail, erreursConfigEmail } from "@mip/backend/lib/net/resend.mjs";
import { secretsDeSignature } from "@mip/backend/lib/net/signature-webhook.mjs";
import { creerLivreur, INTERVALLE_DEFAUT_MS } from "@mip/backend/jobs/livreur.mjs";

const log = createLogger("notifier");

// AVANT TOUT `await` : un SIGTERM pendant la première passe doit trouver son gestionnaire.
const lifecycle = installLifecycle({ log });

/** Les règles croisées de l'e-mail, rapportées sur la variable à corriger. */
const reglesEmail = (variable) => () =>
  erreursConfigEmail(process.env)
    .filter((e) => e.variable === variable)
    .map((e) => e.erreur)
    .join(" ; ") || null;

const config = defineConfig(
  {
    ...COMMON_ENV,
    // Obligatoire, SANS repli sur un Postgres local.
    DATABASE_URL: { type: "url", required: true, secret: true, protocols: ["postgres:", "postgresql:"], description: "Postgres (pooler Neon en production)." },
    PGPOOL_MAX: { type: "int", default: 2, min: 2, max: 10, description: "Taille du pool : une livraison à la fois, plus les sondes." },
    NOTIFIER_INTERVAL_MS: {
      type: "int",
      default: INTERVALLE_DEFAUT_MS,
      min: 5_000,
      max: 3_600_000,
      description: "Délai entre deux passes. 15 s par défaut ; 300000 laisse le compute Neon s'endormir entre deux ticks du scheduler.",
    },
    RESEND_API_KEY: { type: "string", secret: true, validate: reglesEmail("RESEND_API_KEY"), description: "Clé d'API Resend (droit « Sending access » seul). Absente : les livraisons e-mail sont soldées skipped, avec la raison." },
    ALERT_EMAIL_FROM: { type: "string", validate: reglesEmail("ALERT_EMAIL_FROM"), example: "onboarding@resend.dev", description: "Expéditeur des alertes. `@resend.dev` = domaine non vérifié, mode test obligatoire." },
    ALERT_EMAIL_TEST_RECIPIENTS: { type: "list", description: "Mode test : seuls ces destinataires sont servis, les autres soldés skipped avec la raison." },
    WEBHOOK_SIGNING_SECRET: {
      type: "string",
      secret: true,
      validate: (brut) => {
        const valeurs = secretsDeSignature(brut);
        if (valeurs.length > 2) return "deux valeurs au plus (nouvelle,ancienne)";
        if (valeurs.some((v) => v.length < 32)) return "chaque valeur doit faire au moins 32 caractères";
        return null;
      },
      description: "Signe les webhooks (x-mip-signature). « nouveau,ancien » pendant une rotation. Absent : identifiant de livraison seul.",
    },
    TICKET_SECRET_KEY: {
      type: "string",
      secret: true,
      validate: (brut) => {
        const octets = /^[0-9a-fA-F]{64}$/.test(brut) ? Buffer.from(brut, "hex") : Buffer.from(brut, "base64");
        return octets.length === 32 ? null : "32 octets attendus, en hexadécimal ou en base64";
      },
      description: "Clé des références de tickets `enc:v1:` — la MÊME, à l'octet près, que celle qui les a chiffrées. Absente : ces intégrations passent en degraded.",
    },
  },
  { service: "notifier", log },
);

const metrics = createMetrics();
const pool = createPool(pg, {
  connectionString: config.DATABASE_URL,
  applicationName: "mip-notifier",
  max: config.PGPOOL_MAX,
  log,
  metrics,
  lifecycle,
});

const email = configEmail({
  RESEND_API_KEY: config.RESEND_API_KEY,
  ALERT_EMAIL_FROM: config.ALERT_EMAIL_FROM,
  ALERT_EMAIL_TEST_RECIPIENTS: config.ALERT_EMAIL_TEST_RECIPIENTS?.join(","),
});
const livreur = creerLivreur({
  pool,
  log,
  metrics,
  email,
  secretSignature: secretsDeSignature(config.WEBHOOK_SIGNING_SECRET)[0] ?? null,
  intervalleMs: config.NOTIFIER_INTERVAL_MS,
});

// Première passe IMMÉDIATE : ce qui attendait pendant le redéploiement part tout de suite.
startLoop({
  name: "livraison",
  intervalMs: config.NOTIFIER_INTERVAL_MS,
  run: () => livreur.passe(),
  log,
  lifecycle,
  metrics,
  immediate: true,
});
startLoop({ name: "reconciliation", intervalMs: 3_600_000, run: () => livreur.reconcilier(), log, lifecycle, metrics });

// Sans domaine généré, ce serveur n'est joignable que par le réseau privé du
// projet. Aucune route hors sondes : tout le reste répond 404.
startService({
  name: "notifier",
  port: config.PORT,
  log,
  pool,
  metrics,
  metricsToken: config.METRICS_TOKEN,
  lifecycle,
  ready: () => livreur.etat(),
});

log.info("notifier démarré", {
  db: describeTarget(config.DATABASE_URL),
  intervalle_ms: config.NOTIFIER_INTERVAL_MS,
  // Ni la clé, ni les adresses : combien, et en quel mode.
  email: email ? { expediteur: email.from, mode_test: Boolean(email.destinatairesTest), destinataires_test: email.destinatairesTest?.size ?? 0 } : "non configuré",
  signature: Boolean(config.WEBHOOK_SIGNING_SECRET),
  tickets_cle: Boolean(config.TICKET_SECRET_KEY),
});
