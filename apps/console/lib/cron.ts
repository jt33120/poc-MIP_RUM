// Socle HTTP des routes planifiées (/api/cron/*).
//
// CE QUI RESTE ICI : l'authentification et la traduction en Response. Le TRAVAIL
// lui-même est descendu dans le noyau (`@mip/backend/jobs/planifie.mjs`), parce qu'il
// est désormais exécuté par deux déclencheurs : ces routes, et le service
// `scheduler` déployé sur Railway. Deux copies auraient divergé sans que rien
// ne le signale — les deux auraient « marché ».
//
// CE MODULE N'EST PLUS APPELÉ (23/09/2026). Les routes `/api/cron/*` répondent
// 410 : elles appelaient `travaux()` SANS prendre de bail, et le commentaire qui
// tenait ici affirmait le contraire — « le verrou consultatif côté scheduler
// empêche un double passage ». C'était faux dans les deux sens : le scheduler
// utilise un bail (une ligne avec expiration), pas un verrou consultatif, et ce
// bail ne protège que ceux qui le demandent. Ces routes ne le demandaient pas.
//
// Le déclenchement manuel passe par `services/scheduler/run-once.mjs`, qui prend
// le bail. Ce fichier disparaît avec les routes.
import { travaux } from "@mip/backend/jobs/planifie.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";
import { pool } from "./db";

export const log = createLogger("cron");

/**
 * Un planificateur n'a pas de cookie de session : l'auth se fait par
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Fail-CLOSED : sans CRON_SECRET configuré, la route refuse (503) au lieu de
 * s'ouvrir à tout l'internet — ces endpoints purgent des données et postent des
 * webhooks, les laisser anonymes serait un vecteur d'abus trivial.
 */
export function assertCronAuth(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("CRON_SECRET missing — refusing to run scheduled job");
    return Response.json({ error: "cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Les travaux, câblés sur le pool de la console.
 *
 * `dispatch` est chargé À LA DEMANDE : `dispatch-alerts.mjs` sort vers
 * l'extérieur (webhooks) et n'a rien à faire dans le graphe de modules d'une
 * route qui ne l'appelle pas.
 */
async function jobs() {
  const { dispatchOnce } = await import("@mip/backend/lib/dispatch-alerts.mjs");
  return travaux(pool, { log, dispatch: dispatchOnce });
}

/** Exécute une cadence et traduit son bilan en réponse HTTP. */
export async function lancer(cadence: "tick" | "horaire" | "quotidien"): Promise<Response> {
  const t = await jobs();
  const bilan = await t[cadence]();
  log.info("cron tick", { cadence, echecs: bilan.echecs });
  // 207 = échec partiel : une étape a échoué, les autres ont tourné. Le
  // planificateur doit le voir sans que le détail soit masqué.
  return Response.json({ ok: bilan.ok, results: bilan.resultats }, { status: bilan.echecs ? 207 : 200 });
}
