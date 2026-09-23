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
// EXCLUSION. Deux instances (un redéploiement qui chevauche, une montée à deux
// répliques) ne doivent pas lancer le même travail en parallèle. Les fonctions
// SQL sont idempotentes, mais compter là-dessus pour des sondes réseau et des
// webhooks serait un pari : un client recevrait l'alerte en double.
//
// La première version prenait un verrou consultatif de session. Elle ne tenait
// pas : la connexion de production passe par le pooler Neon (PgBouncer en mode
// TRANSACTION), où un verrou de session est pris sur un backend et perdu au
// suivant. Deux instances se seraient crues seules toutes les deux. On passe
// donc par un BAIL — une ligne avec une date d'expiration, qui ne dépend
// d'aucune propriété de session. Cf. ingest/jobs/bail.mjs.
import http from "node:http";
import pg from "pg";
import { dispatchOnce } from "@mip/backend/lib/dispatch-alerts.mjs";
import { randomUUID } from "node:crypto";
import { DUREES, SQL_TABLE, prendreBail, rendreBail } from "@mip/backend/jobs/bail.mjs";
import { CADENCES, prochainDelai } from "@mip/backend/jobs/cadence.mjs";
import { travaux } from "@mip/backend/jobs/planifie.mjs";
import { creerPool, cible } from "@mip/backend/lib/serveur.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";

const log = createLogger("scheduler");

// Fail-fast, comme le migrateur. Sans DATABASE_URL, `creerPool` retombe sur le
// Postgres LOCAL de développement : le worker tournerait alors indéfiniment en
// tapant dans le vide toutes les 5 minutes, en ayant l'air de vivre. Mieux vaut
// un déploiement qui refuse de partir et le dit.
if (!process.env.DATABASE_URL) {
  log.error("DATABASE_URL absent — le scheduler refuse de démarrer");
  process.exit(2);
}

const pool = creerPool(pg, { max: 4 });
const jobs = travaux(pool, { log, dispatch: dispatchOnce });

/** Qui tient les baux : une identité par PROCESS, pas par cadence. Railway
 *  fournit l'identifiant du déploiement ; sinon un UUID fait l'affaire. */
const PORTEUR = process.env.RAILWAY_DEPLOYMENT_ID ?? `local-${randomUUID()}`;

/** Dernier passage de chaque travail, pour /status. */
const dernier = {};
const demarre = new Date().toISOString();

/**
 * Lance un travail sous verrou. Le verrou est pris sur UNE connexion dédiée et
 * relâché sur la même : un verrou de session pris via le pool serait relâché
 * par n'importe quelle connexion rendue, ce qui ne verrouille rien.
 */
async function sousVerrou(nom, executer) {
  // `pool.connect()` est DANS le try. Il y était à côté, et c'est ce qui a tué
  // le premier déploiement : une base injoignable faisait remonter le rejet
  // hors de cette fonction, donc en rejet non capturé, donc en arrêt du
  // process — exactement ce que le commentaire ci-dessous prétendait éviter.
  let client = null;
  let tenu = false;
  try {
    client = await pool.connect();
    // Ceinture, pas bretelle : depuis migration-v54 la table vient du schéma.
    // On garde l'appel (`if not exists`, donc gratuit) pour que le scheduler
    // reste déployable seul sur une base qu'on n'aurait pas migrée.
    await client.query(SQL_TABLE);
    tenu = await prendreBail(client, { job: nom, porteur: PORTEUR, secondes: DUREES[nom] });
    if (!tenu) {
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
      await rendreBail(client, { job: nom, porteur: PORTEUR }).catch(() => {});
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
    client?.release();
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

// --- Sonde HTTP -------------------------------------------------------------
// TOUJOURS active, même sans PORT fourni : un worker sans écoute n'a rien à
// offrir au healthcheck de l'hébergeur, qui déclare alors le déploiement en
// échec sans que rien ne soit cassé. Sans domaine généré, ce serveur n'est
// joignable que par le réseau privé du projet.
// Aucune donnée client n'y transite : des dates et des compteurs.
{
  const port = process.env.PORT ?? 8080;
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
    .listen(port, () => log.info("sonde http", { port: Number(port) }));
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
