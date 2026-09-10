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
import { lignesDepuisExport, normaliserEtat, scoreDepuisEtat } from "./adaptateurs.mjs";

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
      const brut = JSON.parse(await readFile(file, "utf8"));
      const map = MIPPOC_MAPPING[brut?.measure_name];
      if (!map) throw new Error(`mesure non mappée: ${brut?.measure_name}`);
      // La transformation vit dans adaptateurs.mjs — PUR, donc testable sans
      // PostgreSQL. C'est là que se joue la perte d'information, et une
      // transformation qu'on ne peut pas tester sans base ne se teste jamais.
      const { lignes, rejets, vues } = lignesDepuisExport(brut, map);
      return { lignes, rejets, vues };
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
      // ALIGNÉ SUR UNE GRILLE DE 15 MINUTES, et pas sur l'instant d'exécution.
      // Un robot passe sur une grille ; sans cet alignement, rejouer le seed deux
      // fois dans la même minute créerait deux séries décalées de quelques
      // secondes, donc deux fois plus de passages qu'il n'y en a eu. Avec la
      // grille, rejouer dans le même quart d'heure est idempotent, et le
      // quart d'heure suivant ajoute un passage — ce que fait un vrai robot.
      const PAS_MS = 15 * 60_000;
      const now = Math.floor(Date.now() / PAS_MS) * PAS_MS;
      for (const m of SEED_MEASURES) {
        for (let min = 24 * 60; min >= 0; min -= 15) {
          const at = new Date(now - min * 60_000);
          // fenêtre dégradée simulée il y a 6-7 h (latence x2,5, warn/incident)
          const degraded = min >= 360 && min < 420;
          const jitter = 0.8 + rand() * 0.4;
          const latency = m.base_ms * jitter * (degraded ? 2.5 : 1);
          const etatBrut = degraded ? (min < 390 ? "KO" : "WARNING") : "OK";
          out.push({
            app_id: appId,
            site: "G-IT Plateforme (seed)",
            measure_id: m.measure_id,
            measure_name: m.measure_name,
            // La source réelle n'en fournit pas ; le seed n'en invente pas non
            // plus. C'est (measure_id, captured_at) qui identifie un passage.
            execution_id: null,
            measure_type: "SEED",
            route_hint: m.route_hint,
            score: scoreDepuisEtat(normaliserEtat(etatBrut)),
            state: normaliserEtat(etatBrut),
            state_source: etatBrut,
            latency_ms: Math.round(latency),
            metrics: { first_load_time: String(Math.round(latency)) },
            captured_at: at,
          });
        }
      }
      return { lignes: out, rejets: [], vues: out.length };
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

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// LE TÉMOIN EST OUVERT AVANT LE TRAVAIL. Un import qui meurt en cours doit
// laisser sa trace : sans ça, « l'import ne tourne plus » et « le robot ne
// trouve rien » se ressemblent — la table ne bouge plus dans les deux cas.
const { rows: [ouverture] } = await pool.query("select syn_import_ouvrir($1) as id", [source.name]);
const importId = ouverture.id;

let vues = 0;
let ecrites = 0;
let rejets = [];
try {
  const res = await source.fetchSnapshots();
  vues = res.vues;
  rejets = res.rejets;

  // PLUS DE `delete`. L'ancien code faisait
  //     delete from syn_snapshot where measure_id = any($1)
  // sans borne de temps : sur la source `seed`, tout l'historique de la mesure
  // partait à chaque passage, puis 24 h étaient réinsérées. Le miroir ne portait
  // donc jamais plus d'une journée — et la matrice de corrélation, qui exige huit
  // seaux appariés, était impossible par construction.
  //
  // `on conflict do update` sur (app_id, measure_id, execution_id) rend l'import
  // idempotent SANS rien effacer : rejouer le même export ne duplique pas, et
  // un export corrigé écrase la ligne qu'il corrige.
  for (const s of res.lignes) {
    const { rowCount } = await pool.query(
      `insert into syn_snapshot
         (app_id, site, measure_id, measure_name, execution_id, measure_type,
          route_hint, score, state, state_source, latency_ms, metrics, captured_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
       on conflict (app_id, measure_id, captured_at)
         do update set score = excluded.score, state = excluded.state,
                       state_source = excluded.state_source, latency_ms = excluded.latency_ms,
                       metrics = excluded.metrics, captured_at = excluded.captured_at,
                       ingested_at = now()`,
      [s.app_id, s.site, s.measure_id, s.measure_name, s.execution_id, s.measure_type,
       s.route_hint, s.score, s.state, s.state_source, s.latency_ms,
       JSON.stringify(s.metrics ?? {}), s.captured_at],
    );
    ecrites += rowCount;
  }

  await pool.query("select syn_import_clore($1, true, $2, $3, $4, null)", [
    importId, vues, ecrites, rejets.length,
  ]);
  if (rejets.length) {
    // Nommés, pas comptés en silence : un format qui change se lirait sinon
    // « le robot s'est arrêté ».
    console.error(`[sync-synthetic] ${rejets.length} exécution(s) REJETÉE(S) :`);
    for (const r of rejets) console.error(`  · id=${r.id} — ${r.motif}`);
  }
  console.log(
    `[sync-synthetic] source=${source.name} vues=${vues} écrites=${ecrites} rejetées=${rejets.length}`,
  );
} catch (err) {
  // L'ÉCHEC EST ENREGISTRÉ AVANT D'ÊTRE PROPAGÉ. Un import qui plante en silence
  // est indiscernable d'un import qui n'a jamais été planifié.
  await pool
    .query("select syn_import_clore($1, false, $2, $3, $4, $5)", [
      importId, vues, ecrites, rejets.length, String(err?.stack ?? err),
    ])
    .catch(() => {});
  console.error(`[sync-synthetic] ÉCHEC : ${String(err?.message ?? err)}`);
  await pool.end();
  process.exit(1);
}
await pool.end();
