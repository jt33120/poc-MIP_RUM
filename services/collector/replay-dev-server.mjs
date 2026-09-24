// Receveur replay local (:4319) — même code que le reste de l'ingestion.
//
// Il reste un process SÉPARÉ du receveur OTLP alors que le service de
// production sert les trois signaux ensemble, et c'est voulu : les tests de
// bout en bout démarrent les deux serveurs indépendamment (playwright.config.ts)
// et pointent le replay sur :4319. Les fusionner en local ferait diverger la
// configuration de test de ce qu'elle vérifie.
//
// `/__health` est conservé comme alias : c'est l'URL que Playwright interroge
// pour savoir si le serveur est prêt.
import pg from "pg";
import { creerReceveur } from "@mip/backend/lib/receiver.mjs";
import { creerPool, demarrerServeur, cible } from "@mip/backend/lib/serveur.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";

const log = createLogger("replay");
const pool = creerPool(pg, { max: 3 });

const { handler } = creerReceveur(pool, {
  log,
  nom: "replay",
  signaux: ["replay"],
  aliasSante: ["/__health"],
});

demarrerServeur(handler, {
  port: process.env.REPLAY_PORT ?? 4319,
  pool,
  log,
  nom: "replay",
  infos: { db: cible() },
});
