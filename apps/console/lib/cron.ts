// Socle des routes planifiées (/api/cron/*).
//
// Ces routes remplacent les jobs `pg_cron` : l'extension existe bien sur Neon,
// mais ne s'installe QUE dans la base `postgres` du projet, jamais dans
// `neondb` — donc les blocs `cron.schedule(...)` des migrations, tous gardés
// par `if exists (pg_extension where extname='pg_cron')`, sont silencieusement
// sautés. Sans ce relais, purge, rollups, metering, SLO et alertes ne tournent
// tout simplement pas.
//
// Les fonctions SQL elles-mêmes ne changent pas : c'est uniquement le
// DÉCLENCHEUR qui passe de pg_cron à Vercel Cron.
import { createLogger } from "ingest/shared/log.mjs";
import { q } from "./db";

export const log = createLogger("cron");

/**
 * Un scheduler n'a pas de cookie de session : l'auth se fait ici, par
 * `Authorization: Bearer $CRON_SECRET`. Vercel Cron envoie cet en-tête si la
 * variable est définie.
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
 * Exécute une série de tâches SANS qu'un échec n'annule les suivantes : une
 * purge qui casse ne doit pas emporter le metering du même tick. Chaque
 * résultat est rapporté individuellement — le job répond 200 si tout passe,
 * 207 s'il y a des échecs partiels (visible dans les logs Vercel).
 */
export async function runSteps(
  steps: Array<{ name: string; run: () => Promise<unknown> }>,
): Promise<Response> {
  const results: Record<string, unknown> = {};
  let failed = 0;
  for (const step of steps) {
    const started = Date.now();
    try {
      results[step.name] = { ok: true, result: await step.run(), ms: Date.now() - started };
    } catch (err) {
      failed++;
      results[step.name] = { ok: false, error: String(err), ms: Date.now() - started };
      log.error("cron step failed", { step: step.name, err: String(err) });
    }
  }
  log.info("cron tick", { steps: steps.length, failed });
  return Response.json({ ok: failed === 0, results }, { status: failed ? 207 : 200 });
}

/** Appelle une fonction SQL sans argument et renvoie sa valeur de retour. */
export async function callFn(fn: string): Promise<unknown> {
  const rows = await q<Record<string, unknown>>(`select ${fn} as result`);
  return rows[0]?.result ?? null;
}
