// Dispatch des webhooks d'alerte — pendant LOCAL de pg_net (ROADMAP v0.3 B1).
// check_alerts() v2 insère une ligne alert_delivery 'queued' par règle avec
// webhook_url ; en cloud pg_net poste directement, en local ce script prend
// le relais : POST du même payload JSON (champ `text` compatible Slack), puis
// statut sent/failed + code http dans `response`.
// Usage : node apps/ingest/dispatch-alerts.mjs [--once|--loop]  (--loop : poll 30 s)
//
// ÉVÉNEMENTS SANS RÈGLE (migration-v73). La sélection joignait `alert_rule` en
// jointure interne : nouvelles erreurs, SLO, uptime et notifications d'issue
// restaient `queued` pour toujours. Dès v73, ils partent aussi — seulement ceux
// déclenchés depuis `alert_config.rule_less_dispatch_since`, l'arriéré ayant été
// soldé par la migration. Avant v73, la sélection historique est conservée.
//
// DEUX DÉCLENCHEURS. Le tick tourne depuis le scheduler Railway ET depuis la route
// cron appelée par GitHub : chaque livraison est réservée par `for update skip
// locked`, postée et marquée dans SA transaction, la passe concurrente prend les
// suivantes. Une passe interrompue (fonction coupée à 60 s, requête en échec) ne
// rejoue donc que la livraison en cours, jamais celles déjà marquées. Une passe
// est bornée en nombre et par une échéance, pour tenir dans la minute de la route
// cron ; ce qui reste part au passage suivant.
import pg from "pg";
import { createLogger } from "./supabase/functions/_shared/log.mjs";

const log = createLogger("dispatch-alerts");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const POLL_MS = Number(process.env.DISPATCH_POLL_MS || 30_000);
const TIMEOUT_MS = Number(process.env.DISPATCH_TIMEOUT_MS || 10_000);
/** Livraisons réservées par passe. */
const LOT = Number(process.env.DISPATCH_BATCH || 50);
/** Au-delà, aucune nouvelle livraison n'est entamée dans la passe (échéance par défaut). */
const BUDGET_MS = Number(process.env.DISPATCH_BUDGET_MS || 40_000);

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

/**
 * Corps d'une livraison, selon ce qui l'a déclenchée : la charge minimale d'une
 * notification d'issue telle que l'outbox l'a figée, le payload d'une règle, ou,
 * pour un événement sans règle (nouvelle erreur, SLO, uptime), son message.
 * @param {{notification?: object|null, metric?: string|null, severity?: string, message?: string|null}} d
 */
export function payloadOf(d) {
  if (d.notification) return d.notification;
  if (d.metric) return buildPayload(d);
  return { source: "mip-rum", severity: d.severity, text: `[MIP RUM] ${d.message ?? ""}` };
}

/** Le dispatcher ne sait poster qu'en HTTP(S) : une adresse e-mail n'est pas une URL. */
export function cibleHttp(target) {
  try {
    const url = new URL(target);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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
 * Réservation de la prochaine livraison à tenter : 'queued' + 'failed' éligibles au
 * rejeu (sous le plafond ET passé le backoff de 30 s × 2^attempts). Une ligne à la
 * fois : elle reste verrouillée le temps de son POST, puis sa transaction valide.
 * @param {boolean} v73  migration-v73 appliquée (événements sans règle livrables)
 */
export function selectionSql(v73) {
  const sources = v73
    ? `left join alert_rule r on r.id = e.rule_id
       left join error_issue_notification n on n.alert_event_id = e.id
       left join alert_config c on c.singleton`
    : "join alert_rule r on r.id = e.rule_id";
  return `select d.id, d.target, d.attempts, e.value, e.message, e.severity,
                 r.app_id, r.metric, r.route, r.threshold, r.window_minutes, r.comparator,
                 ${v73 ? "n.payload" : "null::jsonb"} as notification
            from alert_delivery d
            join alert_event e on e.id = d.alert_event_id
            ${sources}
           where (d.status = 'queued'
                  or (d.status = 'failed'
                      and d.attempts < $1
                      and d.attempted_at < now() - (interval '30 seconds' * power(2, d.attempts))))
             ${v73 ? "and (e.rule_id is not null or e.fired_at >= c.rule_less_dispatch_since)" : ""}
           order by d.id
           limit 1
           for update of d skip locked`;
}

/**
 * Livre une livraison réservée : cible non HTTP soldée `skipped`, sinon POST borné
 * par le temps restant, puis statut. Le client est celui de la transaction qui
 * tient la réservation.
 */
async function livrer(client, d, resteMs, bilan) {
  if (!cibleHttp(d.target)) {
    await client.query(
      "update alert_delivery set status = 'skipped', response = $1, attempted_at = now() where id = $2",
      ["cible non HTTP : le dispatcher local ne livre que des webhooks", d.id],
    );
    bilan.skipped++;
    log.warn("delivery", { id: d.id, status: "skipped", response: "cible non HTTP" });
    return;
  }
  let ok = false;
  let response;
  try {
    const res = await fetch(d.target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadOf(d)),
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, resteMs)),
    });
    response = `http ${res.status}`;
    ok = res.ok;
  } catch (err) {
    response = String(err.cause?.code ?? err.message).slice(0, 200);
  }
  const status = decideStatus(ok, d.attempts ?? 0);
  await client.query(
    "update alert_delivery set status = $1, response = $2, attempts = attempts + 1, attempted_at = now() where id = $3",
    [status, response, d.id],
  );
  if (status === "delivered") bilan.sent++;
  else if (status === "dead") bilan.dead++;
  else bilan.failed++;
  log[ok ? "info" : "warn"]("delivery", {
    id: d.id,
    target: d.target,
    status,
    attempt: (d.attempts ?? 0) + 1,
    response,
  });
}

/**
 * Traite une passe de livraisons en attente, une transaction par livraison.
 * `echeance` (ms epoch) : aucune livraison n'est entamée au-delà ; par défaut
 * `budgetMs` après l'appel. Le tick passe la sienne, mesurée depuis son début.
 * @returns {Promise<{sent:number, failed:number, dead:number, skipped:number}>}
 */
export async function dispatchOnce(pool, { lot = LOT, budgetMs = BUDGET_MS, echeance = Date.now() + budgetMs } = {}) {
  const bilan = { sent: 0, failed: 0, dead: 0, skipped: 0 };
  const { rows: [schema] } = await pool.query(
    "select to_regclass('public.error_issue_notification') is not null as v73",
  );
  const selection = selectionSql(schema.v73);
  for (let n = 0; n < lot; n++) {
    const reste = echeance - Date.now();
    if (reste <= 0) break;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: [d] } = await client.query(selection, [MAX_ATTEMPTS]);
      if (!d) {
        await client.query("commit");
        break;
      }
      await livrer(client, d, reste, bilan);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return bilan;
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
    const { sent, failed, dead, skipped } = await dispatchOnce(pool);
    log.info("pass", { sent, failed, dead, skipped });
    if (loop && running) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (loop && running);
  await pool.end();
}
