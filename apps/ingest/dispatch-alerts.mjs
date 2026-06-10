// Dispatch des webhooks d'alerte — pendant LOCAL de pg_net (ROADMAP v0.3 B1).
// check_alerts() v2 insère une ligne alert_delivery 'queued' par règle avec
// webhook_url ; en cloud pg_net poste directement, en local ce script prend
// le relais : POST du même payload JSON (champ `text` compatible Slack), puis
// statut sent/failed + code http dans `response`.
// Usage : node apps/ingest/dispatch-alerts.mjs [--once|--loop]  (--loop : poll 30 s)
import pg from "pg";

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

/** Traite les alert_delivery 'queued' : POST + maj statut. Retourne {sent, failed}. */
export async function dispatchOnce(pool) {
  const { rows } = await pool.query(
    `select d.id, d.target, e.value,
            r.app_id, r.metric, r.route, r.threshold, r.window_minutes, r.comparator
       from alert_delivery d
       join alert_event e on e.id = d.alert_event_id
       join alert_rule  r on r.id = e.rule_id
      where d.status = 'queued'
      order by d.id`,
  );
  let sent = 0;
  let failed = 0;
  for (const d of rows) {
    let status = "failed";
    let response;
    try {
      const res = await fetch(d.target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(d)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      response = `http ${res.status}`;
      if (res.ok) status = "sent";
    } catch (err) {
      response = String(err.cause?.code ?? err.message).slice(0, 200);
    }
    await pool.query(
      "update alert_delivery set status = $1, response = $2, attempted_at = now() where id = $3",
      [status, response, d.id],
    );
    if (status === "sent") sent++;
    else failed++;
    console.log(`[dispatch-alerts] #${d.id} ${d.target} -> ${status} (${response})`);
  }
  return { sent, failed };
}

// Exécution CLI uniquement (le module reste importable par les tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const loop = process.argv.includes("--loop");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  do {
    const { sent, failed } = await dispatchOnce(pool);
    console.log(`[dispatch-alerts] pass: sent=${sent} failed=${failed}`);
    if (loop) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (loop);
  await pool.end();
}
