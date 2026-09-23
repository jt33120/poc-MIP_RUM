// Déclenchement MANUEL d'une cadence, sous bail — le remplaçant des routes
// `/api/cron/*`, qui répondent désormais 410.
//
// POURQUOI CE FICHIER EXISTE. Rejouer un travail à la main était possible par
// `/api/cron/{tick,hourly,daily}`, qui appelaient `travaux()` SANS prendre de
// bail : un déclenchement manuel pendant que le worker travaillait faisait
// tourner la même cadence deux fois. Les étapes qui lisent puis insèrent sans
// verrou — bascule de SLO, anomalies IA, sondes uptime — pouvaient alors produire
// deux événements d'alerte et sonder deux fois la même URL. Ici, le bail est pris
// exactement comme dans `worker.mjs` : si le worker tient la cadence, ce
// processus le DIT et sort en 3, au lieu de doubler le travail.
//
// Usage :
//   railway run --service scheduler node services/scheduler/run-once.mjs tick
//   … hourly | daily   (alias acceptés : horaire, quotidien)
//
// Codes de sortie : 0 travail exécuté · 2 configuration refusée ·
// 3 bail tenu ailleurs (rien n'a été fait) · 4 le travail a rendu un échec.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { dispatchOnce } from "ingest/dispatch-alerts.mjs";
import { DUREES, SQL_TABLE, prendreBail, rendreBail } from "ingest/jobs/bail.mjs";
import { travaux } from "ingest/jobs/planifie.mjs";
import { creerPool, cible } from "ingest/lib/serveur.mjs";
import { createLogger } from "ingest/shared/log.mjs";

const log = createLogger("run-once");

/** Les noms anglais de la ligne de commande, les noms français du code. */
const CADENCES = { tick: "tick", hourly: "horaire", horaire: "horaire", daily: "quotidien", quotidien: "quotidien" };

export function resoudreCadence(argv) {
  const brut = (argv ?? "").trim().toLowerCase();
  return CADENCES[brut] ?? null;
}

async function main() {
  const nom = resoudreCadence(process.argv[2]);
  if (!nom) {
    log.error("cadence inconnue", { recu: process.argv[2] ?? null, attendu: "tick | hourly | daily" });
    process.exit(2);
  }
  // Même fail-fast que le worker et le migrateur : sans DATABASE_URL, `creerPool`
  // retombe sur le Postgres local et le travail s'exécuterait dans le vide, en
  // ayant l'air d'avoir réussi.
  if (!process.env.DATABASE_URL) {
    log.error("DATABASE_URL absent — rien n'est exécuté");
    process.exit(2);
  }

  const pool = creerPool(pg, { max: 2 });
  const jobs = travaux(pool, { log, dispatch: dispatchOnce });
  const porteur = `manuel-${process.env.RAILWAY_DEPLOYMENT_ID ?? randomUUID()}`;
  log.info("déclenchement manuel", { job: nom, db: cible(), porteur });

  let code = 0;
  const client = await pool.connect();
  let tenu = false;
  try {
    await client.query(SQL_TABLE);
    tenu = await prendreBail(client, { job: nom, porteur, secondes: DUREES[nom] });
    if (!tenu) {
      log.warn("bail tenu ailleurs — rien n'a été fait", { job: nom });
      code = 3;
    } else {
      const debut = Date.now();
      const bilan = await jobs[nom]();
      log[bilan.ok ? "info" : "error"]("travail terminé", {
        job: nom,
        ok: bilan.ok,
        echecs: bilan.echecs,
        ms: Date.now() - debut,
        resultats: bilan.resultats,
      });
      if (!bilan.ok) code = 4;
    }
  } finally {
    if (tenu) await rendreBail(client, { job: nom, porteur }).catch(() => {});
    client.release();
    await pool.end().catch(() => {});
  }
  process.exit(code);
}

// Exécuté directement seulement : importé par les tests, il ne doit rien lancer.
if (process.argv[1] && process.argv[1].endsWith("run-once.mjs")) {
  main().catch((err) => {
    log.error("échec du déclenchement manuel", { err: String(err?.stack ?? err) });
    process.exit(1);
  });
}
