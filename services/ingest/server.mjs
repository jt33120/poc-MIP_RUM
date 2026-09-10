// Service « ingest » — le receveur OTLP de MIP RUM.
//
// POST /v1/traces   métriques, erreurs, sessions, spans (OTLP/HTTP JSON)
// POST /v1/logs     signal LOGS d'OpenTelemetry
// POST /v1/replay   chunk rrweb gzippé (métadonnées en en-têtes x-mip-*)
// GET  /health      le process répond
// GET  /ready       la base répond
//
// Ce fichier ne contient AUCUNE logique d'ingestion : elle vit dans
// `ingest/lib/receiver.mjs`, partagée avec le dev-server et alignée sur les
// routes Next de la console. Le service n'est qu'un point d'entrée — c'est
// exactement ce qui le rend déplaçable chez un autre hébergeur.
//
// Les trois signaux tiennent dans UN service : ils écrivent dans la même base,
// partagent le registre d'apps, la vérification de clé et le compteur de débit.
// Les séparer dupliquerait ces caches sans rien isoler — le jour où le replay
// (corps binaires lourds) mérite son propre profil de charge, la découpe se
// fait ici, en changeant `signaux`.
import pg from "pg";
import { creerReceveur } from "ingest/lib/receiver.mjs";
import { drainerIngestRaw } from "ingest/lib/ingest-differe.mjs";
import { creerPool, demarrerServeur, cible } from "ingest/lib/serveur.mjs";
import { createLogger } from "ingest/shared/log.mjs";

const log = createLogger("ingest");

// Fail-fast. Sans DATABASE_URL, `creerPool` retombe sur le Postgres LOCAL de
// développement : le service répondrait 200 aux beacons et perdrait tout en
// silence — le pire des comportements pour de la télémétrie.
if (!process.env.DATABASE_URL) {
  log.error("DATABASE_URL absent — le service d'ingestion refuse de démarrer");
  process.exit(2);
}

const pool = creerPool(pg, { max: 8 });

const { handler } = creerReceveur(pool, {
  log,
  // `tampon` reste éteint : /__recent retient des payloads en clair, c'est un
  // outil d'assertion de test, pas une fonctionnalité.
  nom: "ingest",
  tampon: false,
  signaux: ["traces", "logs", "replay"],
});

// LE DRAIN VIT ICI, ET PAS DANS LE SCHEDULER. La table de débarquement est une
// file de quelques centaines de millisecondes : la drainer toutes les cinq
// minutes rendrait la console aveugle pendant cinq minutes et ferait grossir une
// table UNLOGGED — c'est-à-dire une table qu'un redémarrage brutal vide. Le
// travailleur tourne donc dans le processus qui reçoit, au plus près.
//
// Une seule boucle, ré-armée APRÈS coup : un drain lent ne s'empile pas sur
// lui-même. `unref` pour que ce minuteur n'empêche jamais l'arrêt du process —
// c'est le serveur HTTP qui le maintient en vie, pas le drain.
const DIFFERE = process.env.INGEST_DEFERRED === "true";
const DRAIN_MS = Number(process.env.INGEST_DRAIN_MS ?? 250);

if (DIFFERE) {
  const boucle = async () => {
    try {
      const { drains, echecs } = await drainerIngestRaw(pool, { max: 200, log });
      if (echecs) log.warn("drain: lots en échec", { drains, echecs });
    } catch (err) {
      // Une base injoignable ne doit PAS tuer le receveur : les lots restent en
      // attente et le passage suivant les reprendra. Un service qui meurt à la
      // première coupure est pire que pas de drain du tout.
      log.error("drain interrompu", { err: String(err?.message ?? err) });
    }
    setTimeout(boucle, DRAIN_MS).unref();
  };
  setTimeout(boucle, DRAIN_MS).unref();
  log.info("ingestion différée active", { drain_ms: DRAIN_MS });
}

demarrerServeur(handler, {
  // Railway impose le port par PORT ; INGEST_PORT garde la parité locale.
  port: process.env.PORT ?? process.env.INGEST_PORT ?? 4318,
  pool,
  log,
  nom: "ingest",
  infos: {
    db: cible(),
    require_api_key: process.env.REQUIRE_API_KEY === "true",
    rate_per_min: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
    // Annoncé sur /health : un opérateur doit pouvoir lire, sans fouiller les
    // variables, si ce déploiement acquitte avant d'avoir écrit.
    ingest_deferred: DIFFERE,
  },
});
