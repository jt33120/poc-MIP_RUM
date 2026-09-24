// Bench de charge / preuve de capacité (B2). Étend scripts/load-light.mjs (qui
// n'est qu'un sanity ~1 000 events) en un VRAI bench paramétrable :
//   1. charge : POST OTLP vers une cible configurable, en boucle FERMÉE
//      (CONCURRENCY POST en vol, jusqu'à TARGET_EVENTS ou pendant DURATION_S) ou
//      OUVERTE (RATE lots/s à arrivées poissonniennes, pendant DURATION_S) ;
//      mesure le débit soutenu (lots/s, events/s), les statuts et les
//      percentiles de latence (p50/p95/p99) ;
//   2. requêtes : à volume, chronométre les requêtes console lourdes
//      (p75 vitals, top routes par sessions, heatmap horaire, série journalière).
//
// POURQUOI LA BOUCLE OUVERTE (P2). La porte go/no-go du collector se lit en
// « utilisation du verrou d'application À UN DÉBIT DONNÉ » (3 × le pic). Une
// boucle fermée ne fixe pas le débit : elle le subit — chaque POST attend le
// précédent, et le débit mesuré est celui de la saturation. Pour tracer
// utilisation = f(débit), il faut IMPOSER le débit, et l'imposer avec des
// arrivées réalistes (poissonniennes : des rafales, pas un métronome ; c'est
// la rafale qui fait attendre au verrou). Un « lot » = un POST = UNE session
// d'UNE app : c'est l'unité que sérialise `withAppIngestTransaction`.
//
// IMPORTANT (B2) : à lancer contre une base TYPE-PROD (pas le free tier). Rien
// n'est exécuté automatiquement en CI ; c'est un outil opérateur. Voir la doc
// d'usage en tête de fichier et labs/clickhouse/NOTES.md. Porte P2 :
// docs/operations/banc-collecteur-2026-09-24.md et
// scripts/bench/banc-collecteur-local.mjs.
//
// Usage :
//   ENDPOINT=https://<ingest>/v1/traces \
//   BENCH_DATABASE_URL=postgres://user:pwd@host:5432/db \
//   TARGET_EVENTS=1000000 CONCURRENCY=32 \
//   node scripts/load-bench.mjs
//
//   # porte P2 : 4 lots/s sur UNE app pendant 30 s, sans phase base
//   ENDPOINT=https://<collector>/v1/traces APP=gip-banc API_KEY=mip_… \
//   RATE=4 DURATION_S=30 DB_PHASE=0 node scripts/load-bench.mjs
//
//   # auto-test du générateur, sans réseau ni base, sans chiffres de capacité :
//   node scripts/load-bench.mjs --dry-run
//
// Variables (toutes optionnelles, défauts entre crochets) :
//   ENDPOINT        [http://localhost:4318/v1/traces]  cible OTLP/HTTP
//   BENCH_DATABASE_URL  phase requêtes + comptage ; à défaut DATABASE_URL, puis
//                   [postgres://postgres:postgres@localhost:5433/mip_rum]. BENCH_ d'abord :
//                   le `.env` du poste fait pointer DATABASE_URL sur la production.
//   DB_PHASE        [1]         0 = ni requêtes console, ni comptage, ni nettoyage (charge seule)
//   TARGET_EVENTS   [1000000]   nombre d'events à injecter (boucle fermée sans DURATION_S)
//   CONCURRENCY     [32]        POST en vol simultanés (boucle fermée)
//   RATE            [0]         > 0 : boucle OUVERTE, lots/s imposés (DURATION_S obligatoire)
//   DURATION_S      [—]         durée de la charge ; en boucle fermée, remplace TARGET_EVENTS
//   ARRIVALS        [poisson]   poisson | uniform — loi des arrivées en boucle ouverte
//   MAX_IN_FLIGHT   [512]       boucle ouverte : au-delà, l'arrivée est comptée `skipped`
//   SEED            [1]         graine des arrivées poissonniennes (rejouables)
//   APP             [load-bench] app_id (isolation + nettoyage)
//   API_KEY         [—]         clé d'ingestion de l'app (`mip.api_key` sur la resource),
//                               pour une cible sous REQUIRE_API_KEY=true
//   RUN_ID          [horloge]   0..9999, préfixe des identifiants de session/trace/span : deux
//                               runs sur la même base n'écrivent pas les mêmes spans (sinon
//                               `on conflict do nothing` rendrait le second run moins cher)
//   VITAL_IDS       [1]         1 = `webvital.id` sur chaque vital, comme le SDK
//                               (packages/rum-sdk/src/vitals.ts) ; 0 = profil d'avant
//   ERROR_RATE      [0.02]      proba d'erreur JS par session
//   QUERY_ITERS     [20]        répétitions de chaque requête console chronométrée
//   KEEP            [0]         1 = ne pas nettoyer les données de charge en fin de run
//   STORE           [postgres]  postgres | clickhouse — backend de la phase requêtes
//   CLICKHOUSE_URL  [http://localhost:8123]   (si STORE=clickhouse)
//   CLICKHOUSE_DB   [mip_rum]                 (si STORE=clickhouse)
import pg from "pg";
import { pathToFileURL } from "node:url";
import { createChWriter } from "../labs/clickhouse/writer.mjs";

// --- config ----------------------------------------------------------------
const num = (k, d) => Number(process.env[k] ?? d);
const str = (k, d) => process.env[k] ?? d;
export const CONFIG = {
  endpoint: str("ENDPOINT", "http://localhost:4318/v1/traces"),
  databaseUrl: process.env.BENCH_DATABASE_URL ?? str("DATABASE_URL", "postgres://postgres:postgres@localhost:5433/mip_rum"),
  dbPhase: str("DB_PHASE", "1") !== "0",
  targetEvents: num("TARGET_EVENTS", 1_000_000),
  concurrency: num("CONCURRENCY", 32),
  rate: num("RATE", 0),
  durationSec: process.env.DURATION_S ? Number(process.env.DURATION_S) : null,
  arrivals: str("ARRIVALS", "poisson"),
  maxInFlight: num("MAX_IN_FLIGHT", 512),
  seed: num("SEED", 1),
  app: str("APP", "load-bench"),
  apiKey: process.env.API_KEY || null,
  // Chiffres seulement : le préfixe entre dans des identifiants hexadécimaux.
  run: String(Math.abs(Math.trunc(num("RUN_ID", Date.now() % 10_000))) % 10_000),
  vitalIds: str("VITAL_IDS", "1") !== "0",
  errorRate: num("ERROR_RATE", 0.02),
  queryIters: num("QUERY_ITERS", 20),
  keep: str("KEEP", "0") === "1",
  store: str("STORE", "postgres"),
};

// --- générateur réaliste (déterministe via index) ---------------------------
// Routes pondérées, dont une lente (/login ×1,4) — même profil que le bench
// ClickHouse (labs/clickhouse/bench.mjs), pour des chiffres comparables.
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
 *
 * Identifiants préfixés par `run` (4 chiffres) : trace = run + i sur 32
 * chiffres, span = run + i (9) + rang (3) sur 16 — des chiffres, donc de
 * l'hexadécimal valide (`isNativeSpanId`), et jamais les mêmes d'un run à
 * l'autre sur une même base.
 */
export function buildPayload(i, opts = {}) {
  const errorRate = opts.errorRate ?? CONFIG.errorRate;
  const rng = opts.rng ?? ((j) => ((Math.sin(i * 99 + j) + 1) / 2)); // [0,1) déterministe
  const app = opts.app ?? CONFIG.app;
  const run = String(opts.run ?? CONFIG.run).padStart(4, "0");
  const apiKey = opts.apiKey === undefined ? CONFIG.apiKey : opts.apiKey;
  const vitalIds = opts.vitalIds ?? CONFIG.vitalIds;
  const r = pickRoute(i);
  const session = `bench-${run}-${i}`;
  const baseNanos = String(Date.now()) + "000000";
  const spans = [];
  const mk = (name, attrs) => ({
    traceId: `${run}${String(i).padStart(28, "0")}`,
    spanId: `${run}${String(i).padStart(9, "0")}${String(spans.length).padStart(3, "0")}`,
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
  // `webvital.id` : le SDK l'émet (il identifie UNE métrique pour UN chargement
  // de page) et l'ingestion en fait `metric_uid` — ce qui coûte, sous le verrou,
  // l'upsert sur `uq_metric_report` et une relecture PAR vital pour la
  // projection (`indexAvecVitalsConsolides`). Un banc sans lui sous-compterait
  // les allers-retours du trafic réel.
  VITALS.forEach((name, j) =>
    spans.push(mk("webvital." + name, [
      { key: "webvital.name", value: sv(name) },
      { key: "webvital.value", value: dv(vitalValue(name, r.slow, rng(j))) },
      ...(vitalIds ? [{ key: "webvital.id", value: sv(`v4-${run}-${i}-${name}`) }] : []),
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
        ...(apiKey ? [{ key: "mip.api_key", value: sv(apiKey) }] : []),
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
//     uniqExact, binding serveur {app:String} (cf. labs/clickhouse/NOTES.md, Δ=0
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

/** Horloge murale haute résolution : la même échelle que la sonde du collector. */
const epochNow = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Générateur pseudo-aléatoire à graine (mulberry32) : deux runs de même SEED
 * tirent les mêmes rafales, donc se comparent. `Math.random` ne le permet pas.
 */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Instants d'arrivée (ms depuis le début) d'une boucle ouverte : `rate` lots/s
 * pendant `durationMs`. Poisson = écarts exponentiels (des rafales, comme des
 * navigateurs indépendants) ; uniform = métronome (le cas optimiste). PURE.
 */
export function arrivalTimes(rate, durationMs, { arrivals = "poisson", rng = prng(1) } = {}) {
  if (!(rate > 0) || !(durationMs > 0)) return [];
  const out = [];
  let t = 0;
  for (;;) {
    t += arrivals === "uniform" ? 1000 / rate : (-Math.log(1 - rng()) / rate) * 1000;
    if (t > durationMs) return out;
    out.push(t);
  }
}

/** Un POST, chronométré ; ne lève jamais (un échec réseau est un statut « 0 »). */
async function postOne(i, stats) {
  const payload = buildPayload(i);
  const reqStart = performance.now();
  let status = 0;
  try {
    const res = await fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = res.status;
    // Vider le corps : sinon la connexion keep-alive reste occupée.
    await res.arrayBuffer().catch(() => {});
  } catch {
    status = 0;
  }
  stats.latencies.push(performance.now() - reqStart);
  stats.statusCounts[status] = (stats.statusCounts[status] ?? 0) + 1;
  status >= 200 && status < 300 ? stats.ok++ : stats.fail++;
  stats.sent++;
  stats.events += eventsInPayload(payload);
  if (stats.sent % 5000 === 0) process.stderr.write(`  …${stats.sent} lots, ${stats.events} events\n`);
}

/**
 * Phase charge. Trois modes :
 *   - boucle OUVERTE (RATE > 0) : arrivées imposées pendant DURATION_S ;
 *   - boucle fermée bornée en TEMPS (DURATION_S) : CONCURRENCY POST en vol ;
 *   - boucle fermée bornée en VOLUME (défaut historique) : jusqu'à TARGET_EVENTS.
 * `window` (horloge murale) borne la phase, réponses comprises : c'est la
 * fenêtre sur laquelle le pilote du banc P2 lit la sonde du collector.
 */
async function loadPhase() {
  const stats = { latencies: [], statusCounts: {}, sent: 0, events: 0, ok: 0, fail: 0 };
  let skipped = 0;
  let mode;
  const t0 = performance.now();
  const startEpochMs = epochNow();

  if (CONFIG.rate > 0) {
    if (!(CONFIG.durationSec > 0)) throw new Error("RATE impose DURATION_S (> 0)");
    mode = "open";
    const times = arrivalTimes(CONFIG.rate, CONFIG.durationSec * 1000, {
      arrivals: CONFIG.arrivals, rng: prng(CONFIG.seed),
    });
    const inFlight = new Set();
    for (let i = 0; i < times.length; i++) {
      const wait = t0 + times[i] - performance.now();
      if (wait > 1) await sleep(wait);
      // Plafond de POST en vol : au-delà, la cible est déjà saturée, et
      // accumuler des sockets mesurerait le générateur, pas le collector.
      if (inFlight.size >= CONFIG.maxInFlight) { skipped++; continue; }
      const p = postOne(i, stats).finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
    await Promise.all(inFlight);
  } else {
    const bounded = CONFIG.durationSec > 0;
    mode = bounded ? "closed-duration" : "closed-volume";
    const sessions = Math.max(1, Math.ceil(CONFIG.targetEvents / eventsInPayload(buildPayload(0))));
    const deadline = bounded ? t0 + CONFIG.durationSec * 1000 : Infinity;
    let next = 0;
    const worker = async () => {
      while (bounded ? performance.now() < deadline : next < sessions) await postOne(next++, stats);
    };
    await Promise.all(Array.from({ length: CONFIG.concurrency }, worker));
  }

  const sec = (performance.now() - t0) / 1000;
  return {
    mode,
    app: CONFIG.app,
    rate: mode === "open" ? CONFIG.rate : null,
    arrivals: mode === "open" ? CONFIG.arrivals : null,
    concurrency: mode === "open" ? null : CONFIG.concurrency,
    // `sessions` = lots postés (un lot = une session) : nom gardé pour les
    // lecteurs existants de ce JSON.
    sessions: stats.sent,
    events: stats.events,
    ok: stats.ok,
    fail: stats.fail,
    skipped,
    statusCounts: stats.statusCounts,
    durationSec: +sec.toFixed(1),
    batchesPerSec: +(stats.ok / sec).toFixed(2),
    throughputEventsPerSec: Math.round(stats.events / sec),
    postLatencyMs: {
      p50: round1(percentile(stats.latencies, 50)),
      p95: round1(percentile(stats.latencies, 95)),
      p99: round1(percentile(stats.latencies, 99)),
    },
    window: { startEpochMs, endEpochMs: epochNow() },
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
      config: { ...CONFIG, databaseUrl: "(masqué)", apiKey: CONFIG.apiKey ? "(masquée)" : null },
      eventsPerSession: perSession,
      plannedSessions: Math.ceil(CONFIG.targetEvents / perSession),
      sampleSpanNames: sample.resourceSpans[0].scopeSpans[0].spans.map((s) => s.name),
    }, null, 2));
    console.log("\n[dry-run] générateur OK — aucun POST, aucune base, aucun chiffre de capacité.");
    return;
  }

  const cible = CONFIG.rate > 0
    ? `${CONFIG.rate} lots/s (${CONFIG.arrivals}) pendant ${CONFIG.durationSec} s`
    : CONFIG.durationSec > 0
      ? `concurrence ${CONFIG.concurrency} pendant ${CONFIG.durationSec} s`
      : `${CONFIG.targetEvents} events, concurrence ${CONFIG.concurrency}`;
  console.error(`[load-bench] ${cible} -> ${CONFIG.endpoint} (app=${CONFIG.app}, run=${CONFIG.run}, store=${CONFIG.store})`);
  const load = await loadPhase();

  // Charge seule (porte P2) : la base mesurée est derrière le collector, et le
  // pilote la lit lui-même ; ni requêtes console, ni nettoyage.
  if (!CONFIG.dbPhase) {
    console.log(JSON.stringify({ load }, null, 2));
    return;
  }

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
