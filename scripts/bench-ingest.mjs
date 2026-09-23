// BANC DE CHARGE DU CHEMIN D'INGESTION.
//
// POURQUOI IL EXISTE. Le finding 2.9 de docs/AUDIT_RUM_EXTERNE.md propose de
// découpler l'ingestion : le receveur écrirait le lot dans une table de
// débarquement UNLOGGED et rendrait la main, un travailleur ferait le reste.
// C'est une bonne idée SI l'écriture est bien ce qui coûte. Ce chantier avait
// été différé faute de mesure, parce qu'ajouter une file d'attente, un
// travailleur et une perte de durabilité sur une intuition serait exactement le
// genre de décision que ce dépôt refuse ailleurs.
//
// CE QUE LE BANC MESURE. Le vrai receveur (`creerReceveur`, celui de la
// production), un vrai PostgreSQL, de vraies requêtes HTTP concurrentes portant
// un lot OTLP réaliste. Latence par requête (p50/p95/p99) et débit.
//
// Usage :
//   DATABASE_URL=postgres://postgres@127.0.0.1:5433/benchin node scripts/bench-ingest.mjs
//   BENCH_REQUETES=600 BENCH_CONCURRENCE=16 node scripts/bench-ingest.mjs
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import pg from "pg";
import { creerReceveur } from "../packages/backend/lib/receiver.mjs";
import { drainerIngestRaw } from "../packages/backend/lib/ingest-differe.mjs";

const SQL_DIR = new URL("../packages/db/sql/", import.meta.url).pathname;
const APP = "bench-ingest";
const REQUETES = Number(process.env.BENCH_REQUETES ?? 400);
const CONCURRENCE = Number(process.env.BENCH_CONCURRENCE ?? 12);

const muet = { info() {}, warn() {}, error() {}, debug() {} };

const fichiers = () => [
  "schema.sql",
  ...readdirSync(SQL_DIR).filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])),
].map((f) => join(SQL_DIR, f));

/**
 * Un lot OTLP RÉALISTE : une session, une page vue, cinq Core Web Vitals, huit
 * ressources, deux tâches longues, une erreur. C'est la forme qu'émet le SDK sur
 * un chargement de page ordinaire — 17 spans, une trentaine de lignes en base.
 *
 * Un lot d'un seul span mesurerait le coût fixe et pas le coût réel.
 */
function lot(n) {
  const sid = `bench-${n}`;
  const base = Date.now() - 1000;
  const span = (nom, attrs, i) => ({
    name: nom,
    spanId: `${sid}-${i}`,
    traceId: `${sid}-t`,
    startTimeUnixNano: String((base + i) * 1e6),
    endTimeUnixNano: String((base + i + 10) * 1e6),
    attributes: Object.entries({
      "mip.session_id": sid,
      "mip.route": `/section-${n % 25}/page-${n % 200}`,
      ...attrs,
    }).map(([key, value]) => ({
      key,
      value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
    })),
  });
  const spans = [
    span("pageview", {
      "mip.visitor_id": `v-${n % 50}`, "mip.url": "https://ex.test/x",
      "mip.referrer": "", "mip.nav_type": "navigate", "mip.tz": "Europe/Paris",
      "mip.device_type": "desktop",
    }, 0),
  ];
  ["LCP", "INP", "CLS", "FCP", "TTFB"].forEach((m, i) =>
    spans.push(span(`webvital.${m}`, {
      "webvital.name": m, "webvital.value": 100 + i * 37,
      "webvital.rating": "good", "webvital.id": `${sid}-${m}`,
    }, 1 + i)));
  for (let i = 0; i < 8; i++)
    spans.push(span("resource", {
      "resource.url": `https://ex.test/a-${i}.js`, "resource.type": "script",
      "resource.duration_ms": 20 + i, "resource.transfer_size": 1024 * i,
    }, 6 + i));
  for (let i = 0; i < 2; i++)
    spans.push(span("longtask", { "longtask.duration_ms": 90 + i }, 14 + i));
  spans.push(span("exception", {
    "exception.type": "TypeError", "exception.message": `boom ${n % 7}`,
    "exception.stacktrace": "at f (a.js:1:1)", "mip.error_source": "a.js",
  }, 16));

  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: "mip.app_id", value: { stringValue: APP } },
          { key: "mip.client_id", value: { stringValue: "bench" } },
          { key: "mip.visitor_id", value: { stringValue: `v-${n % 50}` } },
          { key: "mip.device_type", value: { stringValue: "desktop" } },
        ],
      },
      scopeSpans: [{ spans }],
    }],
  };
}

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

/** Tire REQUETES requêtes avec CONCURRENCE en vol, renvoie les latences en ms. */
async function tirer(port, depart) {
  const latences = [];
  let suivant = 0;
  const corps = [];
  for (let i = 0; i < REQUETES; i++) corps.push(Buffer.from(JSON.stringify(lot(depart + i))));

  async function fil() {
    for (;;) {
      const i = suivant++;
      if (i >= REQUETES) return;
      const t0 = process.hrtime.bigint();
      await new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/v1/traces", method: "POST",
            headers: { "content-type": "application/json", "content-length": corps[i].length } },
          (res) => { res.resume(); res.on("end", () => (res.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`)))); });
        req.on("error", reject);
        req.end(corps[i]);
      });
      latences.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }
  const t0 = process.hrtime.bigint();
  await Promise.all(Array.from({ length: CONCURRENCE }, fil));
  return { latences, msTotal: Number(process.hrtime.bigint() - t0) / 1e6 };
}

async function main() {
  const pool = new pg.Pool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, max: 10 } : { max: 10 });
  const c = await pool.connect();
  for (const f of fichiers()) await c.query(await readFile(f, "utf8"));
  await c.query(
    `insert into app_registry (app_id, name, active, route_limit) values ($1, 'bench', true, 5000)
     on conflict (app_id) do update set active = true, route_limit = 5000`, [APP]);
  c.release();

  /** Un serveur par mode, sur son propre port : changer d'option en cours de
   *  route mesurerait un mélange des deux. */
  async function serveurPour(differe) {
    const { handler } = creerReceveur(pool, { log: muet, nom: "bench", rateLimitPerMin: 10_000_000, differe });
    const s = http.createServer(handler);
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    return s;
  }

  async function mesurer(differe, decalage) {
    const s = await serveurPour(differe);
    const port = s.address().port;
    await tirer(port, decalage); // chauffe : pools, plans, registre, route_registry
    if (differe) await drainerIngestRaw(pool, { max: 100_000, log: muet });

    const mesures = [];
    for (let passe = 0; passe < 3; passe++) {
      const { latences, msTotal } = await tirer(port, decalage + 100_000 * (passe + 1));
      mesures.push({
        p50: pct(latences, 0.5), p95: pct(latences, 0.95), p99: pct(latences, 0.99),
        debit: (REQUETES / msTotal) * 1000,
      });
      // Le drain se fait ENTRE les passes, pas pendant : on mesure la latence du
      // chemin de la requête, pas celle d'un système à l'arrêt qui accumule.
      // Le compter dans la passe suivante fausserait dans l'autre sens.
      if (differe) await drainerIngestRaw(pool, { max: 100_000, log: muet });
    }
    s.close();
    const med = (k) => [...mesures.map((m) => m[k])].sort((a, b) => a - b)[1];
    return { p50: med("p50"), p95: med("p95"), p99: med("p99"), debit: med("debit"), mesures };
  }

  // Alternance : le second mode profiterait sinon des caches du premier.
  const sync1 = await mesurer(false, 1_000_000);
  const diff1 = await mesurer(true, 2_000_000);
  const diff2 = await mesurer(true, 3_000_000);
  const sync2 = await mesurer(false, 4_000_000);
  const moy = (a, b, k) => (a[k] + b[k]) / 2;

  const { rows } = await pool.query(
    "select count(*)::int as n from rum_metric where app_id = $1", [APP]);
  const reste = await pool.query("select count(*)::int as n from ingest_raw");

  console.log(`\n[bench-ingest] ${REQUETES} requêtes × ${CONCURRENCE} en vol, 3 passes par mesure,`);
  console.log(`               deux mesures par mode en ALTERNANCE (sync, différé, différé, sync)`);
  console.log(`               lot réaliste : 17 spans par requête`);
  console.log(`               ${rows[0].n} lignes rum_metric écrites, ${reste.rows[0].n} lots non drainés\n`);
  const ligne = (nom, a, b) =>
    console.log(`  ${nom.padEnd(10)} p50 ${moy(a, b, "p50").toFixed(1).padStart(6)} ms   ` +
                `p95 ${moy(a, b, "p95").toFixed(1).padStart(6)} ms   ` +
                `p99 ${moy(a, b, "p99").toFixed(1).padStart(6)} ms   ` +
                `${moy(a, b, "debit").toFixed(0).padStart(5)} req/s`);
  ligne("synchrone", sync1, sync2);
  ligne("différé", diff1, diff2);
  const dp95 = (1 - moy(diff1, diff2, "p95") / moy(sync1, sync2, "p95")) * 100;
  const ddeb = (moy(diff1, diff2, "debit") / moy(sync1, sync2, "debit") - 1) * 100;
  console.log(`\n  ÉCART      p95 ${dp95 >= 0 ? "-" : "+"}${Math.abs(dp95).toFixed(0)} %   débit ${ddeb >= 0 ? "+" : ""}${ddeb.toFixed(0)} %\n`);
  console.log(`  sync   : ${[sync1, sync2].map((m) => `p95=${m.p95.toFixed(0)}ms ${m.debit.toFixed(0)}req/s`).join("  |  ")}`);
  console.log(`  différé: ${[diff1, diff2].map((m) => `p95=${m.p95.toFixed(0)}ms ${m.debit.toFixed(0)}req/s`).join("  |  ")}\n`);

  await pool.end();
}

main().catch((e) => { console.error("[bench-ingest] échec:", e?.stack ?? e); process.exit(2); });
