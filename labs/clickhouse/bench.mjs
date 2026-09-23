// Bench B4 — Postgres vs ClickHouse sur 100 000 rum_metric réalistes.
// Dataset DÉTERMINISTE (PRNG seedé) : 4 routes, 5 vitals, log-normale, 7 jours.
// Insère dans PG (table bench_metric, indexes alignés prod) ET dans CH (rum_metric_ch),
// exécute 3 requêtes représentatives sur chacun (1 warm-up + 3 runs chronométrés, médiane),
// vérifie l'égalité des p75 (tolérance 1 ms), affiche le tableau comparatif.
//
// Prérequis : docker compose -f docker-compose.clickhouse.yml up -d  (CH :8123)
//             conteneur mip-rum-db up (PG :5433)
// Usage     : node labs/clickhouse/bench.mjs
import { performance } from "node:perf_hooks";
import pg from "pg";
import { createChWriter } from "./writer.mjs";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5433/mip_rum";
const SCHEMA_PATH = new URL("./schema.sql", import.meta.url).pathname;

const N_METRICS = 100_000; // 20 000 pageviews × 5 vitals
const APP_ID = "bench-app";
const SEED = 0x5eed_2026;

// Ancre temporelle FIXE → dataset et fenêtres de requêtes 100 % reproductibles
const T_END = Date.UTC(2026, 5, 10, 12, 0, 0); // 2026-06-10 12:00:00 UTC
const T0 = T_END - 7 * 24 * 3600 * 1000;

// --- PRNG déterministe (mulberry32) ------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
// Box-Muller → normale standard, puis exp() → log-normale
function randNormal() {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const logNormal = (median, sigma) => median * Math.exp(sigma * randNormal());

// --- Profil réaliste : routes (poids + facteur lenteur) et vitals ------------
const ROUTES = [
  { route: "/login", w: 0.3, slow: 1.4 }, // la route lente (cf. POC G-IT)
  { route: "/dashboard", w: 0.35, slow: 1.0 },
  { route: "/partners/:id", w: 0.2, slow: 1.15 },
  { route: "/search", w: 0.15, slow: 0.9 },
];
// median en ms (CLS sans unité), seuils rating 2026 (good ≤ g, poor > p)
const VITALS = {
  LCP: { median: 2400, sigma: 0.45, g: 2500, p: 4000 },
  INP: { median: 180, sigma: 0.6, g: 200, p: 500 },
  CLS: { median: 0.05, sigma: 0.8, g: 0.1, p: 0.25 },
  FCP: { median: 1500, sigma: 0.4, g: 1800, p: 3000 },
  TTFB: { median: 600, sigma: 0.5, g: 800, p: 1800 },
};
const rating = (name, v) => {
  const { g, p } = VITALS[name];
  return v <= g ? "good" : v <= p ? "needs-improvement" : "poor";
};

function pickRoute() {
  const r = rand();
  let acc = 0;
  for (const it of ROUTES) {
    acc += it.w;
    if (r < acc) return it;
  }
  return ROUTES[ROUTES.length - 1];
}

// --- Génération : sessions → pageviews → 5 vitals par pageview ---------------
function generateDataset() {
  const rows = [];
  let session = 0;
  while (rows.length < N_METRICS) {
    session++;
    const sessionId = `bench-s${session}`;
    const pvCount = 1 + Math.floor(rand() * 5); // 1..5 pages par session
    // début de session uniforme sur la fenêtre (marge 30 min avant T_END)
    let pvTs = T0 + rand() * (T_END - T0 - 30 * 60_000);
    for (let p = 0; p < pvCount && rows.length < N_METRICS; p++) {
      const { route, slow } = pickRoute();
      for (const name of Object.keys(VITALS)) {
        if (rows.length >= N_METRICS) break;
        const { median, sigma } = VITALS[name];
        const raw = logNormal(median * (name === "CLS" ? 1 : slow), sigma);
        const value = name === "CLS" ? Math.round(raw * 10000) / 10000 : Math.round(raw * 10) / 10;
        rows.push({
          app_id: APP_ID,
          route,
          name,
          value,
          rating: rating(name, value),
          session_id: sessionId,
          ts: Math.min(Math.round(pvTs + rand() * 5000), T_END - 1),
        });
      }
      pvTs += 30_000 + rand() * 150_000; // 30 s à 3 min entre pages
    }
  }
  return rows;
}

// --- Formats de timestamps ----------------------------------------------------
const fmtPg = (ms) => new Date(ms).toISOString(); // timestamptz non ambigu
const fmtCh = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", ""); // colonne DateTime64 'UTC'

// --- Chargement Postgres : bench_metric (unlogged) + indexes prod-like -------
async function loadPostgres(client, rows) {
  await client.query("drop table if exists bench_metric");
  await client.query(`
    create unlogged table bench_metric (
      app_id text not null, route text, name text not null,
      value double precision not null, rating text,
      session_id text, ts timestamptz not null
    )`);
  const t0 = performance.now();
  const COLS = ["app_id", "route", "name", "value", "rating", "session_id", "ts"];
  const BATCH = 1000;
  await client.query("begin");
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = [];
    const tuples = chunk
      .map((r) => `(${COLS.map((c) => { params.push(c === "ts" ? fmtPg(r.ts) : r[c]); return `$${params.length}`; }).join(",")})`)
      .join(",");
    await client.query(`insert into bench_metric (${COLS.join(",")}) values ${tuples}`, params);
  }
  await client.query("commit");
  const insertMs = performance.now() - t0;
  // mêmes indexes que la prod (idx_metric_name_ts + accès app/route/name/ts)
  await client.query("create index on bench_metric (name, ts)");
  await client.query("create index on bench_metric (app_id, name, route, ts)");
  await client.query("analyze bench_metric");
  return insertMs;
}

// --- Chargement ClickHouse ----------------------------------------------------
async function loadClickhouse(ch, rows) {
  await ch.exec("DROP TABLE IF EXISTS rum_metric_ch");
  await ch.exec("DROP TABLE IF EXISTS rum_pageview_ch");
  await ch.exec("DROP TABLE IF EXISTS rum_error_ch");
  await ch.applySchemaFile(SCHEMA_PATH);
  const t0 = performance.now();
  await ch.insert(
    "rum_metric_ch",
    rows.map((r) => ({ ...r, ts: fmtCh(r.ts) })),
  );
  return performance.now() - t0;
}

// --- Les 3 requêtes représentatives -------------------------------------------
// fenêtres : 24 h et 7 j se terminant à T_END (littéraux fixes → déterministe)
const W24 = [T_END - 24 * 3600 * 1000, T_END];
const W7D = [T0, T_END];

const QUERIES = [
  {
    label: "p75 LCP par route (24 h)",
    pg: {
      sql: `select route, percentile_cont(0.75) within group (order by value) as p75
            from bench_metric
            where name = 'LCP' and ts >= $1 and ts < $2
            group by route order by route`,
      params: [fmtPg(W24[0]), fmtPg(W24[1])],
      map: (r) => ({ key: r.route, val: Number(r.p75) }),
    },
    ch: {
      sql: `SELECT route, quantileExactInclusive(0.75)(value) AS p75
            FROM rum_metric_ch
            WHERE name = 'LCP' AND ts >= toDateTime64('${fmtCh(W24[0])}', 3, 'UTC') AND ts < toDateTime64('${fmtCh(W24[1])}', 3, 'UTC')
            GROUP BY route ORDER BY route`,
      map: (r) => ({ key: r.route, val: Number(r.p75) }),
    },
    compare: "p75", // tolérance 1 ms
  },
  {
    label: "série horaire p75 LCP (7 j)",
    pg: {
      sql: `select to_char(date_trunc('hour', ts at time zone 'UTC'), 'YYYY-MM-DD HH24:00:00') as bucket,
                   percentile_cont(0.75) within group (order by value) as p75
            from bench_metric
            where name = 'LCP' and ts >= $1 and ts < $2
            group by 1 order by 1`,
      params: [fmtPg(W7D[0]), fmtPg(W7D[1])],
      map: (r) => ({ key: r.bucket, val: Number(r.p75) }),
    },
    ch: {
      sql: `SELECT toString(toStartOfHour(ts)) AS bucket, quantileExactInclusive(0.75)(value) AS p75
            FROM rum_metric_ch
            WHERE name = 'LCP' AND ts >= toDateTime64('${fmtCh(W7D[0])}', 3, 'UTC') AND ts < toDateTime64('${fmtCh(W7D[1])}', 3, 'UTC')
            GROUP BY bucket ORDER BY bucket`,
      map: (r) => ({ key: r.bucket, val: Number(r.p75) }),
    },
    compare: "p75",
  },
  {
    label: "top routes par sessions (7 j)",
    pg: {
      sql: `select route, count(distinct session_id)::int as sessions
            from bench_metric
            where ts >= $1 and ts < $2
            group by route order by sessions desc, route limit 10`,
      params: [fmtPg(W7D[0]), fmtPg(W7D[1])],
      map: (r) => ({ key: r.route, val: Number(r.sessions) }),
    },
    ch: {
      sql: `SELECT route, uniqExact(session_id) AS sessions
            FROM rum_metric_ch
            WHERE ts >= toDateTime64('${fmtCh(W7D[0])}', 3, 'UTC') AND ts < toDateTime64('${fmtCh(W7D[1])}', 3, 'UTC')
            GROUP BY route ORDER BY sessions DESC, route LIMIT 10`,
      map: (r) => ({ key: r.route, val: Number(r.sessions) }),
    },
    compare: "exact", // comptages : égalité stricte
  },
];

// chrono chaud : 1 warm-up non compté + 3 runs, on garde la MÉDIANE
async function timed(fn) {
  await fn(); // warm-up
  const runs = [];
  let rows;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    rows = await fn();
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return { median: runs[1], runs, rows };
}

function checkEquality(label, mode, pgRows, chRows) {
  const issues = [];
  if (pgRows.length !== chRows.length)
    issues.push(`nb lignes: PG=${pgRows.length} CH=${chRows.length}`);
  const n = Math.min(pgRows.length, chRows.length);
  let maxDelta = 0;
  for (let i = 0; i < n; i++) {
    if (pgRows[i].key !== chRows[i].key) {
      issues.push(`ligne ${i}: clé PG='${pgRows[i].key}' vs CH='${chRows[i].key}'`);
      continue;
    }
    const delta = Math.abs(pgRows[i].val - chRows[i].val);
    maxDelta = Math.max(maxDelta, delta);
    const tol = mode === "exact" ? 0 : 1; // p75 : tolérance 1 ms d'arrondi
    if (delta > tol)
      issues.push(`ligne ${i} (${pgRows[i].key}): PG=${pgRows[i].val} CH=${chRows[i].val} Δ=${delta}`);
  }
  return { ok: issues.length === 0, maxDelta, issues };
}

// --- Main ----------------------------------------------------------------------
async function main() {
  console.log(`[bench] dataset déterministe : ${N_METRICS} metrics, seed=0x${SEED.toString(16)}, fenêtre ${fmtCh(T0)} → ${fmtCh(T_END)} UTC`);
  const t0 = performance.now();
  const rows = generateDataset();
  const sessions = new Set(rows.map((r) => r.session_id)).size;
  console.log(`[bench] généré en ${Math.round(performance.now() - t0)} ms — ${sessions} sessions, ${rows.length / 5} pageviews`);

  const pgClient = new pg.Client({ connectionString: DATABASE_URL });
  await pgClient.connect();
  await pgClient.query("set time zone 'UTC'");

  const ch = createChWriter();
  if (!(await ch.ping())) {
    console.error("[bench] ClickHouse injoignable sur :8123 — lance d'abord : docker compose -f labs/clickhouse/docker-compose.clickhouse.yml up -d");
    process.exit(1);
  }
  const chVersion = (await ch.query("SELECT version() AS v"))[0].v;
  const pgVersion = (await pgClient.query("show server_version")).rows[0].server_version;

  console.log(`[bench] chargement Postgres ${pgVersion} (:5433, bench_metric unlogged + 2 indexes)…`);
  const pgInsertMs = await loadPostgres(pgClient, rows);
  console.log(`[bench]   insert PG : ${Math.round(pgInsertMs)} ms (batchs de 1000)`);

  console.log(`[bench] chargement ClickHouse ${chVersion} (:8123, rum_metric_ch MergeTree)…`);
  const chInsertMs = await loadClickhouse(ch, rows);
  console.log(`[bench]   insert CH : ${Math.round(chInsertMs)} ms (JSONEachRow, batchs de 10000)`);

  const results = [];
  let allOk = true;
  for (const q of QUERIES) {
    const pgRes = await timed(async () => (await pgClient.query(q.pg.sql, q.pg.params)).rows.map(q.pg.map));
    const chRes = await timed(async () => (await ch.query(q.ch.sql)).map(q.ch.map));
    const eq = checkEquality(q.label, q.compare, pgRes.rows, chRes.rows);
    allOk &&= eq.ok;
    results.push({
      Requête: q.label,
      Lignes: pgRes.rows.length,
      "PG médian (ms)": Number(pgRes.median.toFixed(1)),
      "CH médian (ms)": Number(chRes.median.toFixed(1)),
      "CH/PG": Number((chRes.median / pgRes.median).toFixed(2)),
      "Δ p75 max": Number(eq.maxDelta.toFixed(4)),
      Égalité: eq.ok ? "OK" : "ÉCHEC",
    });
    if (!eq.issues.length) continue;
    console.error(`[bench] ÉCART sur « ${q.label} » :`);
    for (const i of eq.issues.slice(0, 10)) console.error(`         ${i}`);
  }

  // tailles disque (compression colonne = argument volumétrie)
  const pgSize = (await pgClient.query("select pg_total_relation_size('bench_metric') as b")).rows[0].b;
  const chParts = (await ch.query(
    "SELECT sum(bytes_on_disk) AS disk, sum(data_uncompressed_bytes) AS raw FROM system.parts WHERE table = 'rum_metric_ch' AND active",
  ))[0];
  const mb = (b) => (Number(b) / 1024 / 1024).toFixed(1);

  console.log(`\n=== PG ${pgVersion} vs CH ${chVersion} — ${N_METRICS} rum_metric, médiane de 3 runs chauds ===`);
  console.table(results);
  console.log(`Insert : PG ${Math.round(pgInsertMs)} ms | CH ${Math.round(chInsertMs)} ms`);
  console.log(`Disque : PG ${mb(pgSize)} MB (table+indexes) | CH ${mb(chParts.disk)} MB compressé (${mb(chParts.raw)} MB bruts, ×${(Number(chParts.raw) / Number(chParts.disk)).toFixed(1)})`);
  console.log(allOk ? "[bench] ÉGALITÉ p75 VÉRIFIÉE sur les 2 stores (tolérance 1 ms)." : "[bench] DES ÉCARTS SUBSISTENT — voir ci-dessus.");

  // nettoyage PG (la table CH meurt avec le conteneur — volume éphémère)
  await pgClient.query("drop table if exists bench_metric");
  await pgClient.end();
  process.exit(allOk ? 0 : 2);
}

main().catch((err) => {
  console.error("[bench] erreur:", err);
  process.exit(1);
});
