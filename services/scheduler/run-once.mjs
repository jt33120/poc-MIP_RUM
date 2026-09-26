// Déclenchement MANUEL d'une cadence, sous bail — le remplaçant des routes
// `/api/cron/*`, rendues 410 le 23/09/2026 puis supprimées le 25/09/2026 (préparation de C12).
//
// POURQUOI CE FICHIER EXISTE. Rejouer un travail à la main était possible par
// `/api/cron/{tick,hourly,daily}`, qui appelaient `travaux()` SANS prendre de
// bail : un déclenchement manuel pendant que le worker travaillait faisait
// tourner la même cadence deux fois. Les étapes qui lisent puis insèrent sans
// verrou — bascule de SLO, anomalies IA, sondes uptime — pouvaient alors produire
// deux événements d'alerte et sonder deux fois la même URL. Ici, le bail est pris
// par LA MÊME fonction que le worker (`executerSousBail`) : si le worker tient la
// cadence, ce processus le DIT et sort en 3, au lieu de doubler le travail ; un
// passage manuel abouti écrit le battement, un passage en échec ne l'écrit pas.
//
// Usage :
//   railway run --service scheduler node services/scheduler/run-once.mjs tick
//   … hourly | daily   (alias acceptés : horaire, quotidien)
//
// Codes de sortie : 0 travail exécuté · 2 configuration refusée ·
// 3 bail tenu ailleurs (rien n'a été fait) · 4 le travail a rendu un échec ·
// 1 base injoignable ou erreur imprévue.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createPool, describeTarget } from "@mip/service-kit/pg.mjs";
import { dispatchOnce } from "@mip/backend/lib/dispatch-alerts.mjs";
import { travaux } from "@mip/backend/jobs/planifie.mjs";
import { executerSousBail } from "@mip/backend/jobs/ordonnanceur.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";

const log = createLogger("run-once");

/** Les noms anglais de la ligne de commande, les noms français du code. */
const CADENCES = { tick: "tick", hourly: "horaire", horaire: "horaire", daily: "quotidien", quotidien: "quotidien" };

export function resoudreCadence(argv) {
  const brut = (argv ?? "").trim().toLowerCase();
  return CADENCES[brut] ?? null;
}

/**
 * Titulaire d'un passage manuel : préfixé et UNIQUE. `railway run` injecte les
 * variables du service, identifiants de déploiement et de réplique compris :
 * reprendre `titulaireBail()` donnerait au passage manuel le NOM du worker en
 * cours, et `rendreBail` (qui filtre sur le titulaire) pourrait alors rendre le
 * bail du worker. Le déploiement reste lisible, pour savoir d'où il est parti.
 */
export function titulaireManuel(env = process.env, { uuid = randomUUID } = {}) {
  return `manuel:${env.RAILWAY_DEPLOYMENT_ID?.trim() || "local"}:${uuid()}`;
}

async function main() {
  const nom = resoudreCadence(process.argv[2]);
  if (!nom) {
    log.error("cadence inconnue", { recu: process.argv[2] ?? null, attendu: "tick | hourly | daily" });
    process.exit(2);
  }
  // Même fail-fast que le worker et le migrateur : pas de repli sur un Postgres
  // local, où le travail s'exécuterait dans le vide en ayant l'air d'avoir réussi.
  if (!process.env.DATABASE_URL) {
    log.error("DATABASE_URL absent — rien n'est exécuté");
    process.exit(2);
  }

  const pool = createPool(pg, {
    connectionString: process.env.DATABASE_URL,
    applicationName: "mip-scheduler-manuel",
    max: 2,
    log,
  });
  // La même règle que le worker : `SCHEDULER_DELIVERY=off`, le tick ne livre pas
  // (le notifier s'en charge, et lui seul a la clé Resend).
  const livraison = process.env.SCHEDULER_DELIVERY?.trim() !== "off";
  const jobs = travaux(pool, { log, dispatch: dispatchOnce, livraison });
  const porteur = titulaireManuel();
  log.info("déclenchement manuel", { job: nom, db: describeTarget(process.env.DATABASE_URL), porteur, livraison });

  let code = 0;
  try {
    const r = await executerSousBail({ pool, job: nom, porteur, executer: jobs[nom], log });
    if (r.statut === "bail_ailleurs") {
      log.warn("bail tenu ailleurs — rien n'a été fait", { job: nom });
      code = 3;
    } else if (r.statut === "echec") code = 4;
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(code);
}

// Exécuté directement seulement : importé par les tests, il ne doit rien lancer.
if (process.argv[1] && process.argv[1].endsWith("run-once.mjs")) {
  main().catch((err) => {
    log.error("échec du déclenchement manuel", { err });
    process.exit(1);
  });
}
