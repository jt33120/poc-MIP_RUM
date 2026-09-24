// Validation B1 (ROADMAP v0.3) — 3 preuves :
//  (a) alerte test -> check_alerts() -> alert_delivery 'queued' -> dispatchOnce() (dispatch-alerts.mjs)
//      -> POST reçu par un receveur local :9999 + statut 'sent'
//  (b) payload OTLP avec mip.tz='Europe/Paris' -> rum_session.geo_country='FR'
//  (c) rate_check() partagé entre 2 connexions pg distinctes (2 « isolats ») :
//      601e requête de la minute -> false
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";
const RECEIVER_PORT = 9999;
const INGEST_PORT = 14318; // port dédié validation (ne touche pas au :4318 courant)
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const APP_WEBHOOK = "b1-webhook-app";
const APP_GEO = "b1-geo-app";
const APP_RATE = `b1-rate-${Date.now()}`; // unique : compteur vierge à chaque run
const RATE_LIMIT = 600;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- (a) webhook
async function proofWebhook() {
  // receveur HTTP local : collecte les POST /hook
  const received = [];
  const receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve, reject) => {
    receiver.once("error", reject);
    receiver.listen(RECEIVER_PORT, resolve);
  });

  // données de test : nettoyage idempotent puis règle + métriques au-dessus du seuil
  await pool.query("delete from alert_rule where app_id like 'b1-%'"); // cascade event+delivery
  await pool.query("delete from rum_metric where app_id like 'b1-%'");
  await pool.query("delete from rum_pageview where app_id like 'b1-%'");
  await pool.query("delete from rum_session where app_id like 'b1-%'");
  await pool.query("delete from rate_counter where app_id like 'b1-%'");

  const { rows: [rule] } = await pool.query(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, webhook_url)
     values ($1, 'LCP', null, '>', 2000, 15, $2) returning id`,
    [APP_WEBHOOK, `http://localhost:${RECEIVER_PORT}/hook`],
  );
  await pool.query(
    "insert into rum_session (session_id, app_id) values ('b1-webhook-session', $1)",
    [APP_WEBHOOK],
  );
  for (let i = 0; i < 5; i++) {
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1, 'b1-webhook-session', $2, '/login', 'LCP', 5000, 'poor', now())`,
      [`b1-webhook-span-${i}`, APP_WEBHOOK],
    );
  }

  const { rows: [{ check_alerts: fired }] } = await pool.query("select check_alerts()");
  const { rows: queued } = await pool.query(
    `select d.id, d.status from alert_delivery d
       join alert_event e on e.id = d.alert_event_id
      where e.rule_id = $1`,
    [rule.id],
  );

  // Livraison par LA fonction que le scheduler appelle à chaque tick. Ce script
  // lançait `dispatch-alerts.mjs --once` en sous-process : ce mode CLI a été
  // retiré en P1 (une seconde boucle livrerait en concurrence du scheduler).
  // L'échéance d'un POST est lue au chargement du module : posée AVANT l'import.
  process.env.DISPATCH_TIMEOUT_MS = "5000";
  const { dispatchOnce } = await import("../packages/backend/lib/dispatch-alerts.mjs");
  let bilanDispatch = null;
  let erreurDispatch = null;
  try {
    // Le récepteur écoute sur localhost, que `safeFetch` refuse à dessein (P1) :
    // ce script prouve la chaîne de livraison, pas la politique de sortie — il
    // passe donc le `fetch` de la plateforme. La politique a ses propres tests.
    bilanDispatch = await dispatchOnce(pool, { fetchImpl: fetch });
  } catch (err) {
    erreurDispatch = err;
  }

  const { rows: [delivery] } = await pool.query(
    `select d.status, d.response from alert_delivery d
       join alert_event e on e.id = d.alert_event_id
      where e.rule_id = $1 order by d.id desc limit 1`,
    [rule.id],
  );
  await new Promise((r) => receiver.close(r));

  const hook = received.find((m) => m.url === "/hook");
  const payload = hook ? JSON.parse(hook.body) : null;
  checks.push(
    ["(a) check_alerts() déclenche ≥1 alerte", fired >= 1, `fired=${fired}`],
    ["(a) alert_delivery 'queued' créée", queued.length >= 1 && queued[0].status === "queued", `deliveries=${queued.length}`],
    [
      "(a) dispatchOnce() passe sans erreur",
      erreurDispatch === null,
      erreurDispatch ? String(erreurDispatch.message ?? erreurDispatch) : JSON.stringify(bilanDispatch),
    ],
    [
      "(a) POST reçu par le receveur :9999 (payload Slack-compatible)",
      payload?.source === "mip-rum" && payload?.app_id === APP_WEBHOOK && /\[MIP RUM\] LCP > /.test(payload?.text ?? ""),
      payload ? `text="${payload.text}"` : "aucun POST reçu",
    ],
    ["(a) alert_delivery passée à 'sent'", delivery?.status === "sent", `status=${delivery?.status} response=${delivery?.response}`],
  );
}

// ------------------------------------------------------------------- (b) geo
function otlpGeoPayload(sessionId) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "mip.app_id", value: { stringValue: APP_GEO } }] },
        scopeSpans: [
          {
            spans: [
              {
                name: "pageview",
                spanId: `b1-geo-span-${Date.now()}`,
                startTimeUnixNano: String(BigInt(Date.now()) * 1000000n),
                attributes: [
                  { key: "mip.session_id", value: { stringValue: sessionId } },
                  { key: "mip.route", value: { stringValue: "/login" } },
                  { key: "mip.tz", value: { stringValue: "Europe/Paris" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function proofGeo() {
  const server = spawn("node", ["services/collector/dev-server.mjs"], {
    cwd: ROOT,
    // MIP_E2E_TAMPON=1 : opt-in du tampon /__recent, dont ce script attend la réponse.
    env: { ...process.env, DATABASE_URL, INGEST_PORT: String(INGEST_PORT), MIP_E2E_TAMPON: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    // attendre que le receveur écoute (max 10 s)
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      up = await fetch(`http://localhost:${INGEST_PORT}/__recent`).then((r) => r.ok).catch(() => false);
      if (!up) await sleep(200);
    }
    const sessionId = `b1-geo-session-${Date.now()}`;
    const res = await fetch(`http://localhost:${INGEST_PORT}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(otlpGeoPayload(sessionId)),
    });
    await sleep(300); // laisse la transaction se committer
    const { rows } = await pool.query(
      "select geo_country from rum_session where session_id = $1",
      [sessionId],
    );
    checks.push(
      ["(b) POST OTLP avec mip.tz='Europe/Paris' accepté (200)", res.status === 200, `http ${res.status}`],
      ["(b) rum_session.geo_country='FR'", rows[0]?.geo_country === "FR", `geo_country=${rows[0]?.geo_country ?? "(absent)"}`],
    );
  } finally {
    server.kill();
  }
}

// ------------------------------------------------------------ (c) rate_check
async function proofRateCheck() {
  // 2 connexions pg distinctes = 2 « isolats » edge partageant rate_counter
  const c1 = new pg.Client({ connectionString: DATABASE_URL });
  const c2 = new pg.Client({ connectionString: DATABASE_URL });
  await c1.connect();
  await c2.connect();

  // garde-fou : si la minute courante est presque finie, attendre la suivante
  const { rows: [{ s }] } = await c1.query("select extract(second from now())::int as s");
  if (s > 40) await sleep((61 - s) * 1000);

  let allowed = 0;
  for (let i = 0; i < RATE_LIMIT; i++) {
    const client = i % 2 === 0 ? c1 : c2; // alternance entre les 2 isolats
    const { rows: [{ ok }] } = await client.query("select rate_check($1, $2) as ok", [APP_RATE, RATE_LIMIT]);
    if (ok) allowed++;
  }
  const { rows: [{ ok: blocked601 }] } = await c2.query("select rate_check($1, $2) as ok", [APP_RATE, RATE_LIMIT]);
  const { rows: [{ hits }] } = await c1.query(
    "select hits from rate_counter where app_id = $1 order by minute desc limit 1",
    [APP_RATE],
  );
  await c1.end();
  await c2.end();

  checks.push(
    [`(c) ${RATE_LIMIT} premières requêtes acceptées (300 par isolat)`, allowed === RATE_LIMIT, `allowed=${allowed}/${RATE_LIMIT}`],
    ["(c) 601e requête de la minute refusée (compteur partagé)", blocked601 === false, `rate_check 601e=${blocked601}, hits cumulés=${hits}`],
  );
}

// -------------------------------------------------------------------- main
try {
  await proofWebhook();
  await proofGeo();
  await proofRateCheck();
} catch (err) {
  checks.push(["exécution complète sans exception", false, String(err)]);
}
await pool.end();

let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? "  | " + detail : ""}`);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
