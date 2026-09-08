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
import { creerPool, demarrerServeur, cible } from "ingest/lib/serveur.mjs";
import { createLogger } from "ingest/shared/log.mjs";

const log = createLogger("ingest");
const pool = creerPool(pg, { max: 8 });

const { handler } = creerReceveur(pool, {
  log,
  // `tampon` reste éteint : /__recent retient des payloads en clair, c'est un
  // outil d'assertion de test, pas une fonctionnalité.
  nom: "ingest",
  tampon: false,
  signaux: ["traces", "logs", "replay"],
});

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
  },
});
