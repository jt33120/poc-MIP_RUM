// Service « scheduler » — le déclencheur des travaux planifiés de MIP RUM.
//
// CE QU'IL REMPLACE. Trois planificateurs empilés, chacun choisi par défaut et
// non par intérêt : pg_cron (refusé sur Neon), Vercel Cron (plan Hobby : crons
// quotidiens uniquement) et GitHub Actions (facturé à la minute entamée sur un
// dépôt privé, d'où la cadence rabaissée de 5 min à 1 h). Un processus qui
// tourne en continu n'a aucune de ces limites : la cadence redevient un choix
// technique, pas la conséquence d'un plan tarifaire.
//
//   tick        toutes les 5 min   alertes, SLO, sondes uptime, webhooks
//   horaire     à HH:05            rollups, nouvelles erreurs, anomalies
//   quotidien   à 03:17 UTC        purge de rétention, comptage du volume
//
// VERROU. Deux instances (un redéploiement qui chevauche, une montée à deux
// répliques) ne doivent pas lancer le même travail en parallèle. Un verrou
// consultatif Postgres le garantit sans table ni état : il est tenu le temps du
// travail et libéré à la fin, y compris si le process meurt — la session tombe
// avec lui. Les fonctions SQL sont idempotentes, mais compter là-dessus pour
// des sondes réseau et des webhooks serait un pari.
import http from "node:http";
import pg from "pg";
import { dispatchOnce } from "ingest/dispatch-alerts.mjs";
import { CADENCES, prochainDelai } from "ingest/jobs/cadence.mjs";
import { travaux } from "ingest/jobs/planifie.mjs";
import { creerPool, cible } from "ingest/lib/serveur.mjs";
import { createLogger } from "ingest/shared/log.mjs";

const log = createLogger("scheduler");
const pool = creerPool(pg, { max: 4 });
const jobs = travaux(pool, { log, dispatch: dispatchOnce });

/** Clés du verrou consultatif — une par cadence, arbitraires mais stables. */
const VERROUS = { tick: 811_001, horaire: 811_002, quotidien: 811_003 };

/** Dernier passage de chaque travail, pour /status. */
const dernier = {};
const demarre = new Date().toISOString();

/**
 * Lance un travail sous verrou. Le verrou est pris sur UNE connexion dédiée et
 * relâché sur la même : un verrou de session pris via le pool serait relâché
 * par n'importe quelle connexion rendue, ce qui ne verrouille rien.
 */
async function sousVerrou(nom, executer) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("select pg_try_advisory_lock($1) as pris", [VERROUS[nom]]);
    if (!rows[0].pris) {
      log.warn("travail déjà en cours ailleurs — passage sauté", { job: nom });
      return null;
    }
    const debut = Date.now();
    try {
      const bilan = await executer();
      dernier[nom] = { at: new Date().toISOString(), ms: Date.now() - debut, ok: bilan.ok, echecs: bilan.echecs };
      log[bilan.ok ? "info" : "error"]("travail terminé", {
        job: nom,
        ok: bilan.ok,
        echecs: bilan.echecs,
        ms: Date.now() - debut,
        resultats: bilan.resultats,
      });
      return bilan;
    } finally {
      await client.query("select pg_advisory_unlock($1)", [VERROUS[nom]]).catch(() => {});
    }
  } catch (err) {
    // Une erreur ICI (connexion perdue, base injoignable) ne doit PAS tuer le
    // process : le passage suivant retentera. Un scheduler qui meurt à la
    // première coupure réseau est pire que pas de scheduler du tout, parce
    // qu'il donne l'illusion d'avoir tourné.
    dernier[nom] = { at: new Date().toISOString(), ok: false, error: String(err?.message ?? err) };
    log.error("travail en échec", { job: nom, err: String(err?.stack ?? err) });
    return null;
  } finally {
    client.release();
  }
}

function planifier(nom, executer) {
  const armer = () => {
    const delai = prochainDelai(nom, Date.now());
    log.info("prochain passage", { job: nom, dans_s: Math.round(delai / 1000) });
    // PAS de .unref() : ces minuteries sont la seule chose qui maintient le
    // process en vie quand aucune sonde HTTP n'écoute. Les unref'er ferait
    // sortir le worker juste après son premier tick, en silence.
    setTimeout(async () => {
      await sousVerrou(nom, executer);
      armer(); // ré-armé APRÈS coup : un travail lent ne s'empile pas sur lui-même
    }, delai);
  };
  armer();
}

// --- Sonde HTTP (facultative) ----------------------------------------------
// Railway fournit PORT aux services web. Sans domaine généré, ce serveur n'est
// joignable que par le réseau privé du projet — utile pour un healthcheck et
// pour que la page « Santé interne » de la console sache si le scheduler vit.
// Aucune donnée client n'y transite : des dates et des compteurs.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      const chemin = (req.url ?? "/").split("?")[0];
      if (chemin === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", service: "scheduler" }));
      }
      if (chemin === "/status") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ service: "scheduler", depuis: demarre, dernier }));
      }
      res.writeHead(404);
      res.end();
    })
    .listen(process.env.PORT, () => log.info("sonde http", { port: Number(process.env.PORT) }));
}

log.info("scheduler démarré", {
  db: cible(),
  cadences: CADENCES,
});

planifier("tick", jobs.tick);
planifier("horaire", jobs.horaire);
planifier("quotidien", jobs.quotidien);

// Un premier tick immédiat : sans lui, un redéploiement juste après :00 laisse
// jusqu'à 5 minutes sans évaluation d'alerte, en silence.
await sousVerrou("tick", jobs.tick);

async function arreter(signal) {
  log.info("arrêt", { signal });
  try {
    await pool.end();
  } catch {
    /* rien à sauver ici */
  }
  process.exit(0);
}
process.on("SIGTERM", () => arreter("SIGTERM"));
process.on("SIGINT", () => arreter("SIGINT"));
