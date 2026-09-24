// Service « scheduler » — le déclencheur des travaux planifiés de MIP RUM.
//
// CÂBLAGE SEUL. Les travaux vivent dans `@mip/backend/jobs/planifie.mjs`, le bail,
// le battement et l'état dans `@mip/backend/jobs/ordonnanceur.mjs`, la grille
// dans `@mip/backend/jobs/cadence.mjs` ; le processus (configuration, arrêt
// propre, pool, sondes, boucles) dans `@mip/service-kit`.
//
//   tick        toutes les 5 min   alertes, SLO, sondes uptime (+ livraison, voir plus bas)
//               (15 sur la base gratuite : SCHEDULER_TICK_MIN, voir `cadence.mjs`)
//   horaire     à HH:05            rollups, histogrammes, nouvelles erreurs, anomalies
//   quotidien   à 03:17 UTC        purge de rétention, comptage du volume
//
// CE QU'IL REMPLACE. Trois planificateurs empilés, chacun choisi par défaut et
// non par intérêt : pg_cron (refusé sur Neon), Vercel Cron (plan Hobby : crons
// quotidiens uniquement) et GitHub Actions (facturé à la minute entamée). Un
// processus qui tourne en continu n'a aucune de ces limites.
//
// EXCLUSION. Deux instances (un redéploiement qui chevauche, deux répliques, un
// `run-once.mjs` lancé à la main) ne doivent pas lancer la même cadence en
// parallèle : un client recevrait l'alerte en double. D'où un BAIL par cadence
// (une ligne à expiration, qui traverse le pooler Neon en mode transaction, là
// où un verrou de session se perdait) — cf. `@mip/backend/jobs/bail.mjs`.
//
// LA LIVRAISON QUITTE LE SCHEDULER (P5). Webhooks, e-mails et tickets partent du
// service `notifier`, toutes les 15 s, seul détenteur des secrets sortants. Tant
// que `SCHEDULER_DELIVERY` vaut `on` (défaut), le tick livre aussi, comme avant ;
// `off` le réduit à DÉCIDER — les livraisons restent `queued` pour le notifier.
// Le scheduler n'a pas de clé Resend : une livraison e-mail qu'il prendrait
// serait soldée `skipped`. D'où `off` posé au plus tard quand le notifier démarre.
//
// LES SONDES, ET POURQUOI CE PARTAGE :
//   /health   processus vivant + base joignable. C'est LA sonde Railway. « Jamais
//             exécuté » et « bail tenu ailleurs » y sont SAINS : pendant un
//             redéploiement, l'instance sortante tient encore le bail ; une sonde
//             de fraîcheur ferait échouer le déploiement qui doit la remplacer.
//   /ready    fraîcheur de chaque cadence (battement en base) et arriéré de
//   /metrics  livraisons — pour la supervision seulement, derrière METRICS_TOKEN.
import pg from "pg";
import { COMMON_ENV, defineConfig } from "@mip/service-kit/config.mjs";
import { createLogger } from "@mip/service-kit/log.mjs";
import { installLifecycle } from "@mip/service-kit/lifecycle.mjs";
import { createPool, describeTarget } from "@mip/service-kit/pg.mjs";
import { createMetrics } from "@mip/service-kit/metrics.mjs";
import { startService } from "@mip/service-kit/http.mjs";
import { startLoop } from "@mip/service-kit/loop.mjs";
import { dispatchOnce } from "@mip/backend/lib/dispatch-alerts.mjs";
import { TICKS_ADMIS_MIN, TICK_VISE_MIN, decrireCadences, prochainDelai, tolerancesMs } from "@mip/backend/jobs/cadence.mjs";
import { travaux } from "@mip/backend/jobs/planifie.mjs";
import {
  CADENCES_PLANIFIEES,
  creerOrdonnanceur,
  creerSignalDeadman,
  publierCadenceTick,
  titulaireBail,
} from "@mip/backend/jobs/ordonnanceur.mjs";

const log = createLogger("scheduler");

// AVANT TOUT `await` : un SIGTERM reçu pendant le premier tick (qui attend la
// base) doit trouver son gestionnaire. L'ancien worker les enregistrait APRÈS
// `await sousVerrou("tick")` : un redéploiement pendant ce premier passage
// tuait le processus sur place, bail compris, au lieu de le laisser finir.
const lifecycle = installLifecycle({ log });

const config = defineConfig(
  {
    ...COMMON_ENV,
    // Obligatoire, SANS repli : l'ancien `creerPool` retombait sur un Postgres
    // local, et un DATABASE_URL oublié donnait un worker « vivant » qui tapait
    // dans le vide toutes les 5 minutes.
    DATABASE_URL: { type: "url", required: true, secret: true, protocols: ["postgres:", "postgresql:"], description: "Postgres (pooler Neon en production)." },
    PGPOOL_MAX: { type: "int", default: 4, min: 2, max: 20, description: "Taille du pool. Neon plafonne à max_connections = 112 pour tous les services." },
    // L'URL d'un dead-man's switch EST son secret : qui la connaît simule un battement.
    DEADMAN_URL: { type: "url", secret: true, protocols: ["https:"], description: "Dead-man's switch externe, signalé après chaque tick abouti. Absent : aucun signal." },
    SCHEDULER_TICK_MIN: {
      type: "enum",
      values: TICKS_ADMIS_MIN.map(String),
      default: String(TICK_VISE_MIN),
      description: "Cadence du tick, en minutes (diviseur de l'heure). 5 visé ; 15 sur l'offre gratuite de Neon, pour que la base s'endorme entre deux passages.",
    },
    SCHEDULER_DELIVERY: {
      type: "enum",
      values: ["on", "off"],
      default: "on",
      description: "off : le tick ne livre plus (webhooks, e-mails, tickets) — le notifier s'en charge. Retour arrière : on.",
    },
  },
  { service: "scheduler", log },
);

const metrics = createMetrics();
const pool = createPool(pg, {
  connectionString: config.DATABASE_URL,
  applicationName: "mip-scheduler",
  max: config.PGPOOL_MAX,
  log,
  metrics,
  lifecycle,
});

const tickMin = Number(config.SCHEDULER_TICK_MIN);

const ordonnanceur = creerOrdonnanceur({
  pool,
  jobs: travaux(pool, { log, dispatch: dispatchOnce, livraison: config.SCHEDULER_DELIVERY === "on" }),
  porteur: titulaireBail(process.env),
  log,
  metrics,
  signalDeadman: creerSignalDeadman(config.DEADMAN_URL, { log }),
  tolerances: tolerancesMs(tickMin),
});

// La cadence effective, publiée en base au premier tick qui y parvient (puis
// plus jamais : une requête par démarrage, dans la fenêtre où le tick a déjà
// réveillé la base).
let cadencePubliee = false;

// Une boucle par cadence, sur la grille de l'horloge (UTC). La boucle du kit ne
// lance jamais deux passages de front et, au SIGTERM, attend la fin du passage
// en cours avant que le pool ne ferme. Premier tick IMMÉDIAT : sans lui, un
// redéploiement juste après :00 laisse jusqu'à 5 minutes sans évaluation d'alerte.
for (const job of CADENCES_PLANIFIEES) {
  startLoop({
    name: job,
    log,
    lifecycle,
    immediate: job === "tick",
    nextDelay: () => {
      const delai = prochainDelai(job, Date.now(), { tickMin });
      log.info("prochain passage", { job, dans_s: Math.round(delai / 1000) });
      return delai;
    },
    run: async () => {
      const r = await ordonnanceur.executer(job);
      if (job === "tick" && !cadencePubliee) cadencePubliee = await publierCadenceTick(pool, tickMin, { log });
      return r;
    },
  });
}

// Sans domaine généré, ce serveur n'est joignable que par le réseau privé du
// projet. Aucune route hors sondes : tout le reste répond 404.
startService({
  name: "scheduler",
  port: config.PORT,
  log,
  pool,
  metrics,
  metricsToken: config.METRICS_TOKEN,
  lifecycle,
  ready: () => ordonnanceur.etat(),
});

log.info("scheduler démarré", {
  db: describeTarget(config.DATABASE_URL),
  porteur: ordonnanceur.porteur,
  cadences: decrireCadences(tickMin),
  deadman: Boolean(config.DEADMAN_URL),
  livraison: config.SCHEDULER_DELIVERY,
});
