// Dispatch des webhooks d'alerte — pendant LOCAL de pg_net (ROADMAP v0.3 B1).
// check_alerts() v2 insère une ligne alert_delivery 'queued' par règle avec
// webhook_url ; en cloud pg_net poste directement, en local ce script prend
// le relais : POST du même payload JSON (champ `text` compatible Slack), puis
// statut sent/failed + code http dans `response`.
// Usage : node apps/ingest/dispatch-alerts.mjs [--once|--loop]  (--loop : poll 30 s)
import pg from "pg";
import { createLogger } from "./supabase/functions/_shared/log.mjs";

const log = createLogger("dispatch-alerts");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const POLL_MS = Number(process.env.DISPATCH_POLL_MS || 30_000);
const TIMEOUT_MS = Number(process.env.DISPATCH_TIMEOUT_MS || 10_000);

/** Rendu numérique aligné sur round(v::numeric, 1) de check_alerts (ex: '3200.0'). */
function round1(v) {
  return Number(v ?? 0).toFixed(1);
}

/**
 * Payload JSON identique à celui posté par check_alerts v2 via pg_net
 * (migration-v03.sql) — `text` lisible tel quel par un webhook Slack.
 * @param {{app_id: string, metric: string, route: string|null, value: number,
 *          threshold: number, window_minutes: number, comparator: string}} d
 */
export function buildPayload(d) {
  return {
    source: "mip-rum",
    app_id: d.app_id,
    metric: d.metric,
    route: d.route ?? null,
    value: Number(round1(d.value)),
    threshold: d.threshold,
    window_minutes: d.window_minutes,
    text: `[MIP RUM] ${d.metric} ${d.comparator} ${round1(d.value)} (seuil ${d.threshold}) — app ${d.app_id}${d.route ? `, route ${d.route}` : ""}`,
  };
}

// Rejeu borné (R5) : une livraison 'failed' est retentée jusqu'à MAX_ATTEMPTS,
// avec backoff exponentiel ; au-delà elle bascule en 'dead' (état terminal).
const MAX_ATTEMPTS = Number(process.env.DISPATCH_MAX_ATTEMPTS || 5);

/**
 * Statut résultant d'une tentative (logique pure, testable sans DB).
 * @param {boolean} ok      le POST a réussi (2xx)
 * @param {number} attemptsBefore  tentatives déjà effectuées avant celle-ci
 * @param {number} maxAttempts
 * @returns {"sent"|"failed"|"dead"} 'dead' = plafond atteint, on abandonne
 */
export function decideStatus(ok, attemptsBefore, maxAttempts = MAX_ATTEMPTS) {
  // 'delivered' et non 'sent' : ici l'appel est SYNCHRONE, `ok` est un vrai 2xx.
  // Depuis migration-v49, 'sent' est réservé au cas pg_net (asynchrone), où le
  // résultat n'est pas encore connu. Confondre les deux redonnerait à la console
  // un compteur « livrées » qui ne prouve rien.
  if (ok) return "delivered";
  return attemptsBefore + 1 >= maxAttempts ? "dead" : "failed";
}

/**
 * Traite les livraisons en attente : 'queued' (jamais tentées) + 'failed'
 * éligibles au rejeu (sous le plafond ET passé le backoff). POST + maj statut.
 * @returns {Promise<{sent:number, failed:number, dead:number}>}
 */
export async function dispatchOnce(pool) {
  // backoff : une 'failed' n'est re-sélectionnée que si la dernière tentative
  // date d'au moins 30 s × 2^attempts (borné par le power côté SQL).
  const { rows } = await pool.query(
    `select d.id, d.target, d.attempts, e.value,
            r.app_id, r.metric, r.route, r.threshold, r.window_minutes, r.comparator
       from alert_delivery d
       join alert_event e on e.id = d.alert_event_id
       join alert_rule  r on r.id = e.rule_id
      where d.status = 'queued'
         or (d.status = 'failed'
             and d.attempts < $1
             and d.attempted_at < now() - (interval '30 seconds' * power(2, d.attempts)))
      order by d.id`,
    [MAX_ATTEMPTS],
  );
  let sent = 0;
  let failed = 0;
  let dead = 0;
  for (const d of rows) {
    let ok = false;
    let response;
    try {
      const res = await fetch(d.target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(d)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      response = `http ${res.status}`;
      ok = res.ok;
    } catch (err) {
      response = String(err.cause?.code ?? err.message).slice(0, 200);
    }
    const status = decideStatus(ok, d.attempts ?? 0);
    await pool.query(
      "update alert_delivery set status = $1, response = $2, attempts = attempts + 1, attempted_at = now() where id = $3",
      [status, response, d.id],
    );
    if (status === "delivered") sent++;
    else if (status === "dead") dead++;
    else failed++;
    log[ok ? "info" : "warn"]("delivery", {
      id: d.id,
      target: d.target,
      status,
      attempt: (d.attempts ?? 0) + 1,
      response,
    });
  }
  return { sent, failed, dead };
}

// Exécution CLI uniquement (le module reste importable par les tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const loop = process.argv.includes("--loop");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  let running = true;
  // arrêt propre du --loop : on termine la passe courante puis on ferme le pool
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      log.info("stopping", { signal: sig });
      running = false;
    });
  }
  do {
    const { sent, failed, dead } = await dispatchOnce(pool);
    log.info("pass", { sent, failed, dead });
    if (loop && running) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (loop && running);
  await pool.end();
}
