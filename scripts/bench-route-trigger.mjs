// Banc de mesure : ce que le déclencheur de normalisation de route (v62) coûte
// sur le chemin d'écriture.
//
// POURQUOI IL EXISTE. migration-v62 pose la normalisation dans la BASE plutôt
// que dans l'applicatif, parce que deux chemins d'ingestion écrivent ces tables
// et qu'un troisième passerait à côté. Ce choix met une fonction PL/pgSQL sur le
// chemin le plus chaud du produit. « Ça doit être négligeable » n'est pas une
// mesure : ce script en fait une.
//
// PROTOCOLE. Même base, mêmes lignes, mêmes lots, deux passes — déclencheurs
// actifs puis retirés — et on alterne les passes pour que le cache et l'autovacuum
// ne favorisent pas systématiquement la seconde. On mesure le cas RÉEL : des
// routes DÉJÀ connues (une recherche sur la clé primaire de route_registry), qui
// est ce que fait 99,9 % du trafic après la montée en charge. Le cas de la route
// inédite est mesuré à part, parce qu'il écrit.
//
// Usage :
//   DATABASE_URL=postgres://postgres@127.0.0.1:5433/bench node scripts/bench-route-trigger.mjs
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const SQL_DIR = new URL("../apps/ingest/sql/", import.meta.url).pathname;
const APP = "bench-app";
const TABLES = ["rum_metric", "rum_pageview", "rum_error", "rum_longtask",
                "rum_resource", "rum_event", "rum_span", "rum_log", "rum_ai"];
const LOT = 200;      // taille d'un lot d'insertion, ordre de grandeur d'un beacon
const LOTS = 40;      // 8 000 lignes par passe
const PASSES = 6;     // alternées avec / sans

const fichiers = () => [
  "schema.sql",
  ...readdirSync(SQL_DIR).filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])),
].map((f) => join(SQL_DIR, f));

async function poserDeclencheurs(c, actifs) {
  for (const t of TABLES) {
    await c.query(`drop trigger if exists trg_route_${t} on ${t}`);
    if (actifs) {
      await c.query(
        `create trigger trg_route_${t} before insert on ${t}
         for each row when (new.route is not null) execute function mip_trigger_route()`);
    }
  }
}

/** Une passe : LOTS insertions de LOT lignes. Renvoie la durée totale en ms. */
async function passe(c, routes) {
  const debut = process.hrtime.bigint();
  for (let l = 0; l < LOTS; l++) {
    const vals = [];
    const params = [];
    for (let i = 0; i < LOT; i++) {
      const k = params.length;
      params.push(routes[(l * LOT + i) % routes.length], 800 + ((l * i) % 400));
      vals.push(`('bench-s', '${APP}', $${k + 1}, 'LCP', $${k + 2}, 'good')`);
    }
    await c.query(
      `insert into rum_metric (session_id, app_id, route, name, value, rating) values ${vals.join(",")}`,
      params);
  }
  return Number(process.hrtime.bigint() - debut) / 1e6;
}

const mediane = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  for (const f of fichiers()) await c.query(await readFile(f, "utf8"));

  await c.query("delete from rum_metric where app_id = $1", [APP]);
  await c.query("delete from route_registry where app_id = $1", [APP]);
  await c.query("delete from route_cardinality where app_id = $1", [APP]);
  await c.query(
    `insert into app_registry (app_id, name, active, route_limit) values ($1, 'bench', true, 5000)
     on conflict (app_id) do update set route_limit = 5000`, [APP]);
  await c.query(
    `insert into rum_session (session_id, app_id, device_type) values ('bench-s', $1, 'desktop')
     on conflict do nothing`, [APP]);
  // Un motif réaliste : c'est la boucle sur route_pattern qui coûte, pas son
  // absence. Mesurer sans aucun motif mesurerait le meilleur cas.
  await c.query(
    `insert into route_pattern (app_id, motif, remplacement, priorite)
     values ($1, '^/produit/[^/]+$', '/produit/:slug', 10) on conflict do nothing`, [APP]);

  // 500 routes DÉJÀ connues : le régime permanent.
  const routes = Array.from({ length: 500 }, (_, i) => `/section-${i % 25}/page-${i}`);
  await poserDeclencheurs(c, true);
  await passe(c, routes);                       // chauffe + amorce le registre
  await c.query("delete from rum_metric where app_id = $1", [APP]);

  const avec = [];
  const sans = [];
  for (let p = 0; p < PASSES; p++) {
    // Alternance : sans/avec puis avec/sans, pour que l'ordre ne décide pas.
    const ordre = p % 2 === 0 ? [true, false] : [false, true];
    for (const actifs of ordre) {
      await poserDeclencheurs(c, actifs);
      const ms = await passe(c, routes);
      (actifs ? avec : sans).push(ms);
      await c.query("delete from rum_metric where app_id = $1", [APP]);
    }
  }

  // Le cas qui ÉCRIT : une route inédite par ligne, jusqu'au plafond.
  await poserDeclencheurs(c, true);
  const inedites = Array.from({ length: LOT * 4 }, (_, i) => `/inedit/${Date.now()}-${i}`);
  const debutIn = process.hrtime.bigint();
  await passe(c, inedites);
  const msInedites = Number(process.hrtime.bigint() - debutIn) / 1e6;

  const mAvec = mediane(avec);
  const mSans = mediane(sans);
  const lignes = LOT * LOTS;
  console.log(`\n[bench-route-trigger] ${lignes} lignes par passe, ${PASSES} passes alternées\n`);
  console.log(`  sans déclencheur : ${mSans.toFixed(1)} ms  (${(mSans * 1000 / lignes).toFixed(1)} µs/ligne)`);
  console.log(`  avec déclencheur : ${mAvec.toFixed(1)} ms  (${(mAvec * 1000 / lignes).toFixed(1)} µs/ligne)`);
  console.log(`  SURCOÛT          : ${(mAvec - mSans).toFixed(1)} ms  soit ${((mAvec / mSans - 1) * 100).toFixed(1)} %`);
  console.log(`                     ${((mAvec - mSans) * 1000 / lignes).toFixed(2)} µs par ligne insérée`);
  console.log(`\n  routes INÉDITES (chaque ligne écrit dans route_registry) :`);
  console.log(`    ${msInedites.toFixed(1)} ms pour ${lignes} lignes — ${(msInedites * 1000 / lignes).toFixed(1)} µs/ligne`);
  console.log(`\n  détail sans : ${sans.map((x) => x.toFixed(0)).join(", ")}`);
  console.log(`  détail avec : ${avec.map((x) => x.toFixed(0)).join(", ")}\n`);
  await c.end();
}

main().catch((e) => { console.error("[bench-route-trigger] échec:", e?.message ?? e); process.exit(2); });
