// Receveur OTLP local (:4318) — le même code que le service de production.
//
// Ce fichier ne contient plus d'implémentation : elle vit dans
// `lib/receiver.mjs`, partagée avec `services/collector` (Railway) et alignée sur
// les routes Next de la console. C'était nécessaire : les deux copies avaient
// DÉJÀ divergé — sous REQUIRE_API_KEY, ce serveur laissait passer une app sans
// clé là où la production la rejette (durcissement E1-S1, posé dans
// createPgAuth et jamais reporté ici). Un dev-server plus permissif que la
// prod, c'est un test qui passe et un déploiement qui casse.
//
// Deux différences assumées avec la production, et elles ne concernent que le
// développement :
//   • `tampon` demandé : GET /__recent renvoie les derniers payloads reçus,
//     ce sur quoi les tests de bout en bout s'appuient pour affirmer que le
//     navigateur a bien émis ce qu'on croit. Demandé ne veut pas dire allumé :
//     il faut AUSSI `MIP_E2E_TAMPON=1` dans l'environnement (playwright.config.ts
//     et les scripts/validate-* le posent), sinon /__recent répond 404 ;
//   • le port par défaut, 4318, celui qu'attend playwright.config.ts.
import pg from "pg";
import { creerReceveur } from "@mip/backend/lib/receiver.mjs";
import { creerPool, demarrerServeur, cible } from "@mip/backend/lib/serveur.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";

const log = createLogger("ingest");
const pool = creerPool(pg, { max: 5 });

const { handler } = creerReceveur(pool, { log, nom: "ingest", tampon: true });

demarrerServeur(handler, {
  port: process.env.INGEST_PORT ?? 4318,
  pool,
  log,
  nom: "ingest",
  infos: {
    db: cible(),
    require_api_key: process.env.REQUIRE_API_KEY === "true",
    rate_per_min: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
  },
});
