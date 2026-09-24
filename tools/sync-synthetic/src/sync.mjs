// Job de synchro synthétique -> syn_snapshot (PLAN §8.2).
// Interface SyntheticSource (adapter) : la vraie source mippoc se branche
// sans refactor — il suffit d'implémenter fetchSnapshots().
//
// Usage :
//   node src/sync.mjs seed            # runs réalistes pour les routes de la démo (PLAN §8.4)
//   node src/sync.mjs mippoc-json     # parse un export JSON du format réel mippoc (../data/mippoc-sample.json)
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";

/**
 * @typedef {Object} Snapshot  — une ligne syn_snapshot
 * @property {string} app_id @property {string} site @property {string} measure_id
 * @property {string} measure_name @property {string} route_hint @property {number} score
 * @property {string} state @property {number} latency_ms @property {Date} captured_at
 */

/** @typedef {{ name: string, fetchSnapshots: () => Promise<Snapshot[]> }} SyntheticSource */

// ---------------------------------------------------------------- mippoc-json
// Parse le format RÉEL constaté sur le MCP mippoc (get_measure_execution_info,
// sondé le 2026-06-10 — cf. ../data/mippoc-sample.json).
// latency_ms = first_load_time (vécu de chargement, comparable au LCP) ;
// completion_time = durée du scénario robot complet, non comparable.
const MIPPOC_MAPPING = {
  TVMonaco_Loadpage: { app_id: "tvmonaco", site: "TVMonaco", route_hint: "/" },
};

function mippocJsonSource(file) {
  return {
    name: "mippoc-json",
    async fetchSnapshots() {
      const { measure_name, executions } = JSON.parse(await readFile(file, "utf8"));
      const map = MIPPOC_MAPPING[measure_name];
      if (!map) throw new Error(`mesure non mappée: ${measure_name}`);
      return executions.map((e) => ({
        app_id: map.app_id,
        site: map.site,
        measure_id: String(e.id),
        measure_name,
        route_hint: map.route_hint,
        score: e.details.state === "OK" ? 100 : e.details.state === "WARNING" ? 50 : 0,
        state: e.details.state === "OK" ? "ok" : e.details.state === "WARNING" ? "warn" : "incident",
        latency_ms: Number(e.details.metrics.first_load_time),
        captured_at: new Date(e.details.time),
      }));
    },
  };
}

// ----------------------------------------------------------------------- seed
// Fallback PLAN §8.4 : runs synthétiques réalistes pour les routes clés de la
// démo, toutes les 15 min sur 24 h, calqués sur la forme des données mippoc.
// PRNG déterministe (mulberry32) -> re-seedable à l'identique pour les tests.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_MEASURES = [
  { measure_id: "seed-1", measure_name: "LP Accueil", route_hint: "/", base_ms: 450 },
  { measure_id: "seed-2", measure_name: "Parcours Partenaires", route_hint: "/partners", base_ms: 700 },
  { measure_id: "seed-3", measure_name: "Fiche Partenaire", route_hint: "/partners/:id", base_ms: 900 },
];

function seedSource(appId = "demo-app") {
  return {
    name: "seed",
    async fetchSnapshots() {
      const rand = mulberry32(42);
      const out = [];
      const now = Date.now();
      for (const m of SEED_MEASURES) {
        for (let min = 24 * 60; min >= 0; min -= 15) {
          const at = new Date(now - min * 60_000);
          // fenêtre dégradée simulée il y a 6-7 h (latence x2,5, warn/incident)
          const degraded = min >= 360 && min < 420;
          const jitter = 0.8 + rand() * 0.4;
          const latency = m.base_ms * jitter * (degraded ? 2.5 : 1);
          out.push({
            app_id: appId,
            site: "G-IT Plateforme (seed)",
            measure_id: m.measure_id,
            measure_name: m.measure_name,
            route_hint: m.route_hint,
            score: degraded ? 35 : Math.round(90 + rand() * 10),
            state: degraded ? (min < 390 ? "incident" : "warn") : "ok",
            latency_ms: Math.round(latency),
            captured_at: at,
          });
        }
      }
      return out;
    },
  };
}

// ----------------------------------------------------------------------- main
const kind = process.argv[2] ?? "seed";
/** @type {SyntheticSource} */
const source =
  kind === "mippoc-json"
    ? mippocJsonSource(join(__dirname, "../data/mippoc-sample.json"))
    : seedSource(process.argv[3] ?? "demo-app");

const snapshots = await source.fetchSnapshots();
const pool = new pg.Pool({ connectionString: DATABASE_URL });
// one-shot POC : on remplace les snapshots de la même source (idempotent)
await pool.query("delete from syn_snapshot where measure_id = any($1)", [
  [...new Set(snapshots.map((s) => s.measure_id))],
]);
for (const s of snapshots) {
  await pool.query(
    `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [s.app_id, s.site, s.measure_id, s.measure_name, s.route_hint, s.score, s.state, s.latency_ms, s.captured_at],
  );
}
await pool.end();
console.log(`[sync-synthetic] source=${source.name} → ${snapshots.length} snapshots insérés`);
