// Bench de charge / preuve de capacité (B2). Étend scripts/load-light.mjs (qui
// n'est qu'un sanity ~1 000 events) en un VRAI bench paramétrable :
//   1. charge : POST OTLP à concurrence cible jusqu'à TARGET_EVENTS, mesure le
//      débit soutenu (events/s) et les percentiles de latence (p50/p95/p99) ;
//   2. requêtes : à volume, chronométre les requêtes console lourdes
//      (p75 vitals, top routes par sessions, heatmap horaire, série journalière).
//
// IMPORTANT (B2) : à lancer contre une base TYPE-PROD (pas le free tier). Rien
// n'est exécuté automatiquement en CI ; c'est un outil opérateur. Voir la doc
// d'usage en tête de fichier et infra/clickhouse.notes.md.
//
// Usage :
//   ENDPOINT=https://<ingest>/v1/traces \
//   DATABASE_URL=postgres://user:pwd@host:5432/db \
//   TARGET_EVENTS=1000000 CONCURRENCY=32 \
//   node scripts/load-bench.mjs
//
//   # auto-test du générateur, sans réseau ni base, sans chiffres de capacité :
//   node scripts/load-bench.mjs --dry-run
//
// Variables (toutes optionnelles, défauts entre crochets) :
//   ENDPOINT        [http://localhost:4318/v1/traces]  cible OTLP/HTTP
//   DATABASE_URL    [postgres://postgres:postgres@localhost:5433/mip_rum]  phase requêtes + comptage
//   TARGET_EVENTS   [1000000]   nombre d'events à injecter
//   CONCURRENCY     [32]        POST en vol simultanés
//   APP             [load-bench] app_id (isolation + nettoyage)
//   ERROR_RATE      [0.02]      proba d'erreur JS par session
//   QUERY_ITERS     [20]        répétitions de chaque requête console chronométrée
//   KEEP            [0]         1 = ne pas nettoyer les données de charge en fin de run
//   STORE           [postgres]  postgres | clickhouse — backend de la phase requêtes
//   CLICKHOUSE_URL  [http://localhost:8123]   (si STORE=clickhouse)
//   CLICKHOUSE_DB   [mip_rum]                 (si STORE=clickhouse)
import pg from "pg";
import { pathToFileURL } from "node:url";
import { createChWriter } from "../infra/clickhouse/writer.mjs";

// --- config ----------------------------------------------------------------
const num = (k, d) => Number(process.env[k] ?? d);
const str = (k, d) => process.env[k] ?? d;
export const CONFIG = {
  endpoint: str("ENDPOINT", "http://localhost:4318/v1/traces"),
  databaseUrl: str("DATABASE_URL", "postgres://postgres:postgres@localhost:5433/mip_rum"),
  targetEvents: num("TARGET_EVENTS", 1_000_000),
  concurrency: num("CONCURRENCY", 32),
  app: str("APP", "load-bench"),
  errorRate: num("ERROR_RATE", 0.02),
  queryIters: num("QUERY_ITERS", 20),
  keep: str("KEEP", "0") === "1",
  store: str("STORE", "postgres"),
};

// --- générateur réaliste (déterministe via index) ---------------------------
// Routes pondérées, dont une lente (/login ×1,4) — même profil que le bench
// ClickHouse (infra/clickhouse/bench.mjs), pour des chiffres comparables.
const ROUTES = [
  { route: "/", w: 5, slow: 1 },
  { route: "/partners", w: 3, slow: 1 },
  { route: "/partners/:id", w: 2, slow: 1.1 },
  { route: "/login", w: 1, slow: 1.4 },
];
const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"];

function pickRoute(seed) {
  const total = ROUTES.reduce((s, r) => s + r.w, 0);
  let x = (seed % total);
  for (const r of ROUTES) {
    if (x < r.w) return r;
    x -= r.w;
  }
  return ROUTES[0];
}

/** Valeur de vital pseudo-aléatoire bornée (CLS sans unité, autres en ms). */
function vitalValue(name, slow, rnd) {
  if (name === "CLS") return Math.min(0.5, rnd * 0.3 * slow);
  return Math.round((100 + rnd * 2800) * slow);
}

const sv = (s) => ({ stringValue: s });
const dv = (n) => ({ doubleValue: n });

/**
 * Construit le payload OTLP d'UNE session : 1 pageview + 5 vitals + (proba
 * ERROR_RATE) 1 erreur + 1 ressource lente + 1 longtask. Pur et déterministe
 * (rng injectable pour les tests). `i` = index de session.
 */
export function buildPayload(i, opts = {}) {
  const errorRate = opts.errorRate ?? CONFIG.errorRate;
  const rng = opts.rng ?? ((j) => ((Math.sin(i * 99 + j) + 1) / 2)); // [0,1) déterministe
  const app = opts.app ?? CONFIG.app;
  const r = pickRoute(i);
  const session = `bench-${i}`;
  const baseNanos = String(Date.now()) + "000000";
  const spans = [];
  const mk = (name, attrs) => ({
    traceId: String(i).padStart(32, "0"),
    spanId: `${String(i).padStart(8, "0")}${String(spans.length).padStart(8, "0")}`,
    name,
    kind: 1,
    startTimeUnixNano: baseNanos,
    endTimeUnixNano: baseNanos,
    attributes: [
      { key: "mip.session_id", value: sv(session) },
      { key: "mip.route", value: sv(r.route) },
      { key: "mip.tz", value: sv("Europe/Paris") },
      { key: "mip.device_type", value: sv(i % 3 === 0 ? "mobile" : "desktop") },
      ...attrs,
    ],
  });

  spans.push(mk("pageview", [
    { key: "mip.url", value: sv(`https://app.bench.fr${r.route}`) },
    { key: "mip.nav_type", value: sv("navigate") },
  ]));
  VITALS.forEach((name, j) =>
    spans.push(mk("webvital." + name, [
      { key: "webvital.name", value: sv(name) },
      { key: "webvital.value", value: dv(vitalValue(name, r.slow, rng(j))) },
    ])),
  );
  if (rng(7) < errorRate)
    spans.push(mk("exception", [
      { key: "exception.type", value: sv("TypeError") },
      { key: "exception.message", value: sv("undefined is not a function") },
      { key: "exception.stacktrace", value: sv("at handler (app.js)") },
    ]));
  spans.push(mk("resource", [
    { key: "resource.url", value: sv("https://cdn.bench.fr/app.js") },
    { key: "resource.type", value: sv("script") },
    { key: "resource.duration_ms", value: dv(200 + rng(3) * 600) },
  ]));
  spans.push(mk("longtask", [{ key: "longtask.duration_ms", value: dv(60 + rng(5) * 120) }]));

  return {
    resourceSpans: [{
      resource: { attributes: [
        { key: "mip.app_id", value: sv(app) },
        { key: "mip.client_id", value: sv("bench") },
      ] },
      scopeSpans: [{ scope: { name: "load-bench" }, spans }],
    }],
  };
}

/** Nombre d'events (spans) d'un payload. */
export function eventsInPayload(p) {
  return p.resourceSpans.reduce(
    (s, rs) => s + rs.scopeSpans.reduce((ss, sc) => ss + sc.spans.length, 0), 0,
  );
}

/** Percentile (0..100) d'un tableau de nombres ; null si vide. */
export function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1);
  return a[Math.max(0, idx)];
}

// --- requêtes console lourdes (à chronométrer sous charge) -------------------
// Copiées de apps/console/lib (queries / health / queries-grid) pour rester
// autonome du build Next. Deux dialectes, MÊMES requêtes logiques :
//   • postgres : percentile_cont / date_trunc / count(distinct), param $1 = app_id.
//   • clickhouse : quantileTDigest (approx, multi-milliards) / toStartOfHour /
//     uniqExact, binding serveur {app:String} (cf. infra/clickhouse.notes.md, Δ=0
//     prouvé sur les idiomes). Tables suffixées _ch (schema.prod.sql).
const HEAVY_QUERIES_PG = {
  vitals_p75_24h:
    `select name, percentile_cont(0.75) within group (order by value) as p75, count(*)::int n
     from rum_metric where ts > now() - interval '24 hours' and app_id = $1 group by name`,
  top_routes_sessions_7d:
    `select route, count(distinct session_id) as sessions
     from rum_pageview where started_at > now() - interval '7 days' and app_id = $1
     group by route order by sessions desc limit 10`,
  hourly_health_grid_14d:
    `select date_trunc('day', ts) d, extract(hour from ts)::int h,
            sum(case when rating = 'good' then 1 else 0 end)::float good, count(*)::float tot
     from rum_metric where ts > now() - interval '14 days' and app_id = $1 group by 1, 2`,
  daily_lcp_p75_14d:
    `select date_trunc('day', ts) d, percentile_cont(0.75) within group (order by value) p75
     from rum_metric where name = 'LCP' and ts > now() - interval '14 days' and app_id = $1
     group by 1 order by 1`,
};

const HEAVY_QUERIES_CH = {
  vitals_p75_24h:
    `SELECT name, quantileTDigest(0.75)(value) AS p75, count() AS n
     FROM rum_metric_ch WHERE ts > now() - INTERVAL 24 HOUR AND app_id = {app:String} GROUP BY name`,
  top_routes_sessions_7d:
    `SELECT route, uniqExact(session_id) AS sessions
     FROM rum_pageview_ch WHERE ts > now() - INTERVAL 7 DAY AND app_id = {app:String}
     GROUP BY route ORDER BY sessions DESC LIMIT 10`,
  hourly_health_grid_14d:
    `SELECT toDate(ts) AS d, toHour(ts) AS h,
            sumIf(1, rating = 'good') AS good, count() AS tot
     FROM rum_metric_ch WHERE ts > now() - INTERVAL 14 DAY AND app_id = {app:String} GROUP BY d, h`,
  daily_lcp_p75_14d:
    `SELECT toDate(ts) AS d, quantileTDigest(0.75)(value) AS p75
     FROM rum_metric_ch WHERE name = 'LCP' AND ts > now() - INTERVAL 14 DAY AND app_id = {app:String}
     GROUP BY d ORDER BY d`,
};

/** Jeu de requêtes lourdes pour le store demandé (export pour les tests). */
export function heavyQueries(store) {
  return store === "clickhouse" ? HEAVY_QUERIES_CH : HEAVY_QUERIES_PG;
}

// --- phases -----------------------------------------------------------------

/** Phase charge : POST OTLP à concurrence fixe, retourne débit + latences. */
async function loadPhase() {
  const sessions = Math.max(1, Math.ceil(CONFIG.targetEvents / eventsInPayload(buildPayload(0))));
  const latencies = [];
  let sent = 0, events = 0, ok = 0, fail = 0, next = 0;
  const t0 = performance.now();

  async function worker() {
    while (next < sessions) {
      const i = next++;
      const payload = buildPayload(i);
      const reqStart = performance.now();
      try {
        const res = await fetch(CONFIG.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        res.ok ? ok++ : fail++;
      } catch {
        fail++;
      }
      latencies.push(performance.now() - reqStart);
      sent++;
      events += eventsInPayload(payload);
      if (sent % 5000 === 0)
        process.stderr.write(`  …${sent}/${sessions} sessions, ${events} events\n`);
    }
  }
  await Promise.all(Array.from({ length: CONFIG.concurrency }, worker));

  const sec = (performance.now() - t0) / 1000;
  return {
    sessions, events, ok, fail,
    durationSec: +sec.toFixed(1),
    throughputEventsPerSec: Math.round(events / sec),
    postLatencyMs: {
      p50: round1(percentile(latencies, 50)),
      p95: round1(percentile(latencies, 95)),
      p99: round1(percentile(latencies, 99)),
    },
  };
}

/**
 * Phase requêtes : chronométre chaque requête lourde QUERY_ITERS fois. `run(sql)`
 * exécute une requête sur le store courant (PG ou CH) avec app_id = CONFIG.app.
 */
async function queryPhase(run) {
  const out = {};
  for (const [name, sql] of Object.entries(heavyQueries(CONFIG.store))) {
    const lat = [];
    for (let k = 0; k < CONFIG.queryIters; k++) {
      const t = performance.now();
      await run(sql);
      lat.push(performance.now() - t);
    }
    out[name] = { p50: round1(percentile(lat, 50)), p95: round1(percentile(lat, 95)) };
  }
  return out;
}

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// --- main (garde : non exécuté à l'import, donc testable) -------------------
async function main() {
  const dry = process.argv.includes("--dry-run");
  if (dry) {
    const sample = buildPayload(0);
    const perSession = eventsInPayload(sample);
    console.log(JSON.stringify({
      mode: "dry-run",
      config: { ...CONFIG, databaseUrl: "(masqué)" },
      eventsPerSession: perSession,
      plannedSessions: Math.ceil(CONFIG.targetEvents / perSession),
      sampleSpanNames: sample.resourceSpans[0].scopeSpans[0].spans.map((s) => s.name),
    }, null, 2));
    console.log("\n[dry-run] générateur OK — aucun POST, aucune base, aucun chiffre de capacité.");
    return;
  }

  console.error(`[load-bench] cible ${CONFIG.targetEvents} events -> ${CONFIG.endpoint} (concurrence ${CONFIG.concurrency}, store=${CONFIG.store})`);
  const load = await loadPhase();

  const inserted = CONFIG.store === "clickhouse"
    ? await dbPhaseClickhouse()
    : await dbPhasePostgres();

  console.log(JSON.stringify({ load, store: CONFIG.store, ...inserted }, null, 2));
}

/** Phase requêtes + comptage + nettoyage sur Postgres. */
async function dbPhasePostgres() {
  const pool = new pg.Pool({ connectionString: CONFIG.databaseUrl, max: 4 });
  try {
    const { rows: [{ n }] } = await pool.query(
      "select count(*)::int n from rum_metric where app_id = $1", [CONFIG.app]);
    const consoleQueriesMs = await queryPhase((sql) => pool.query(sql, [CONFIG.app]));
    if (!CONFIG.keep) {
      for (const t of ["rum_metric", "rum_pageview", "rum_error", "rum_resource", "rum_longtask", "rum_session"])
        await pool.query(`delete from ${t} where app_id = $1`, [CONFIG.app]);
      console.error("[load-bench] données de charge nettoyées (KEEP=1 pour les garder)");
    }
    return { insertedMetrics: n, consoleQueriesMs };
  } finally {
    await pool.end();
  }
}

/** Phase requêtes + comptage + nettoyage sur ClickHouse (dialecte CH). */
async function dbPhaseClickhouse() {
  const ch = createChWriter();
  if (!(await ch.ping()))
    throw new Error(`ClickHouse injoignable (CLICKHOUSE_URL=${process.env.CLICKHOUSE_URL || "http://localhost:8123"})`);
  const [{ n }] = await ch.query(
    "select count() as n from rum_metric_ch where app_id = {app:String}", { app: CONFIG.app });
  const consoleQueriesMs = await queryPhase((sql) => ch.query(sql, { app: CONFIG.app }));
  if (!CONFIG.keep) {
    // ALTER … DELETE = mutation ASYNCHRONE côté CH (ne libère pas le disque immédiatement).
    // Pour des runs répétés, préférer une base/partition dédiée. On le déclenche quand même.
    for (const t of ["rum_metric_ch", "rum_pageview_ch", "rum_error_ch", "rum_resource_ch", "rum_longtask_ch", "rum_session_ch"])
      await ch.exec(`ALTER TABLE ${t} DELETE WHERE app_id = {app:String}`, { app: CONFIG.app }).catch(() => {});
    console.error("[load-bench] mutations de nettoyage CH déclenchées (asynchrones ; KEEP=1 pour les éviter)");
  }
  return { insertedMetrics: Number(n), consoleQueriesMs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[load-bench] échec:", e?.message ?? e);
    process.exit(1);
  });
}
