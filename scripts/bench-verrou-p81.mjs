// Banc de charge du verrou d'ingestion par application (P8.1).
//
// POURQUOI CE BANC EXISTE. La décision technique de P8.1 est « un verrou par
// application, simple à prouver », avec une condition explicite : le mesurer
// sous contention AVANT de l'activer, et dire si le chiffre le condamne. Un
// protocole qui sérialise l'écriture d'une application entière ne se défend pas
// par l'intention ; il se défend par une latence et un temps d'attente.
//
// CE QU'IL MESURE, ET COMMENT.
//
//   1. la latence de bout en bout de `writeRows` — la vraie fonction, sur le
//      vrai schéma, avec des lots produits par le vrai parser ;
//   2. le TEMPS D'ATTENTE du verrou seul, par une sonde qui ouvre la transaction,
//      prend le verrou et ressort sans rien écrire. C'est la part de la latence
//      imputable au protocole, distincte du coût d'écriture ;
//   3. le nombre de refus `ErreurVerrouIngestion` (attente épuisée) — zéro est
//      le seul résultat acceptable en régime nominal ;
//   4. le même essai réparti sur PLUSIEURS applications, qui doit montrer que la
//      sérialisation est bien locale à une application.
//
// AUCUNE DONNÉE CLIENT. Les lots sont semés par `generate_series` d'identifiants
// synthétiques ; aucun payload de production n'entre ici.
//
// Usage — base JETABLE explicite, jamais DATABASE_URL :
//   BENCH_DATABASE_URL=postgres://postgres:postgres@localhost:5433/p81_bench \
//     node scripts/bench-verrou-p81.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { flattenOtlp } from "../packages/backend/shared/otlp.mjs";
import { writeRows } from "../packages/backend/lib/pg-ingest.mjs";
import { STRATEGIE_VERROU, withAppIngestTransaction } from "../packages/backend/lib/privacy-barriere.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(ICI, "..", "packages", "db", "sql");

const URL_BASE = process.env.BENCH_DATABASE_URL ?? process.env.SQL_TEST_DATABASE_URL;
if (!URL_BASE) {
  console.error(
    "[bench-verrou] BENCH_DATABASE_URL (base JETABLE) est obligatoire.\n" +
    "               DATABASE_URL n'est jamais utilisée par ce banc : il écrit et efface.",
  );
  process.exit(2);
}

/** Lots par niveau de contention. Assez pour un p95 lisible, assez court pour être rejoué. */
const LOTS = Number(process.env.BENCH_LOTS ?? 200);
const NIVEAUX = (process.env.BENCH_WRITERS ?? "1,10,50").split(",").map(Number);
const APPS_REPARTIES = 5;

const pool = new pg.Pool({ connectionString: URL_BASE, max: 60 });

function migrations() {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))]
    .map((f) => join(SQL_DIR, f));
}

const attributs = (o) => Object.entries(o).map(([key, value]) => ({
  key,
  value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
}));

let compteur = 0;
function lot(app) {
  const n = ++compteur;
  const ns = BigInt(Date.now()) * 1_000_000n;
  const span = (nom, extra, i) => ({
    name: nom,
    traceId: "c".repeat(32),
    spanId: (0x8100_0000_0000_0000n + BigInt(n * 4 + i)).toString(16),
    startTimeUnixNano: ns.toString(),
    endTimeUnixNano: (ns + 5_000_000n).toString(),
    attributes: attributs({ "mip.session_id": `bench-${app}-${n}`, "mip.route": "/panier", ...extra }),
  });
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: attributs({ "mip.app_id": app, "mip.client_id": "bench" }) },
      scopeSpans: [{ spans: [
        span("pageview", {
          "mip.visitor_id": `bench-v-${n}`, "mip.url": "https://bench.test/panier",
          "mip.nav_type": "navigate", "mip.device_type": "desktop",
        }, 0),
        span("webvital.LCP", {
          "webvital.name": "LCP", "webvital.value": 1000 + (n % 500),
          "webvital.rating": "good", "webvital.id": `bench-${n}-lcp`,
        }, 1),
      ] }],
    }],
  });
}

const percentile = (valeurs, p) => {
  if (!valeurs.length) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  return tri[Math.min(tri.length - 1, Math.floor((p / 100) * tri.length))];
};
const ms = (v) => (v == null ? "n/d" : `${v.toFixed(1)} ms`);

/** Une passe : `writers` écrivains en parallèle sur `apps`, `LOTS` lots au total. */
async function passe(writers, apps) {
  const latences = [];
  const attentes = [];
  let refus = 0;
  let reste = LOTS;
  const prochain = () => (reste-- > 0);

  const ecrivain = async (indice) => {
    const app = apps[indice % apps.length];
    while (prochain()) {
      const t0 = performance.now();
      try {
        await writeRows(pool, lot(app));
        latences.push(performance.now() - t0);
      } catch (err) {
        if (err?.name === "ErreurVerrouIngestion") refus++;
        else throw err;
      }
    }
  };

  // La sonde tourne PENDANT la charge : c'est la seule façon de mesurer le
  // temps d'attente réellement subi, et non celui d'une base au repos.
  let sonder = true;
  const sonde = (async () => {
    while (sonder) {
      const t0 = performance.now();
      try {
        await withAppIngestTransaction(pool, apps[0], async () => {});
        attentes.push(performance.now() - t0);
      } catch (err) {
        if (err?.name === "ErreurVerrouIngestion") refus++;
        else throw err;
      }
    }
  })();

  const debut = performance.now();
  await Promise.all(Array.from({ length: writers }, (_, i) => ecrivain(i)));
  const duree = performance.now() - debut;
  sonder = false;
  await sonde;

  return {
    writers,
    apps: apps.length,
    duree,
    debit: (LOTS / duree) * 1000,
    latence: { p50: percentile(latences, 50), p95: percentile(latences, 95), max: percentile(latences, 100) },
    attente: { p50: percentile(attentes, 50), p95: percentile(attentes, 95), max: percentile(attentes, 100) },
    refus,
  };
}

function ligne(r, etiquette) {
  return [
    etiquette.padEnd(26),
    String(r.writers).padStart(3),
    String(r.apps).padStart(5),
    ms(r.latence.p50).padStart(10),
    ms(r.latence.p95).padStart(10),
    ms(r.attente.p50).padStart(10),
    ms(r.attente.p95).padStart(10),
    ms(r.attente.max).padStart(10),
    `${r.debit.toFixed(0)}/s`.padStart(9),
    String(r.refus).padStart(6),
  ].join(" ");
}

async function main() {
  for (const f of migrations()) await pool.query(readFileSync(f, "utf8"));
  const apps = Array.from({ length: APPS_REPARTIES }, (_, i) => `bench-app-${i}`);
  for (const app of apps) {
    await pool.query(
      "insert into app_registry (app_id, name, active, route_limit) values ($1,$1,true,50000) on conflict (app_id) do update set active = true",
      [app],
    );
  }
  const nettoyer = async () => {
    for (const t of ["rum_event_index", "rum_metric", "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${t} where app_id = any($1::text[])`, [apps]);
    }
  };

  console.log(`\nBanc P8.1 — verrou d'ingestion par application`);
  console.log(`lots par passe : ${LOTS} · lock_timeout : ${STRATEGIE_VERROU.delaiMs} ms · tentatives : ${STRATEGIE_VERROU.tentatives}`);
  console.log(
    "\n" + "scénario".padEnd(26) + " " + "wr".padStart(3) + " " + "apps".padStart(5) + " " +
    "lat.p50".padStart(10) + " " + "lat.p95".padStart(10) + " " +
    "att.p50".padStart(10) + " " + "att.p95".padStart(10) + " " + "att.max".padStart(10) + " " +
    "débit".padStart(9) + " " + "refus".padStart(6),
  );
  console.log("-".repeat(106));

  const resultats = [];
  for (const writers of NIVEAUX) {
    await nettoyer();
    const une = await passe(writers, [apps[0]]);
    console.log(ligne(une, "une seule application"));
    resultats.push({ scenario: "une application", ...une });
  }
  for (const writers of NIVEAUX) {
    if (writers === 1) continue;
    await nettoyer();
    const reparti = await passe(writers, apps);
    console.log(ligne(reparti, `réparti sur ${APPS_REPARTIES} apps`));
    resultats.push({ scenario: `${APPS_REPARTIES} applications`, ...reparti });
  }

  await nettoyer();
  for (const app of apps) await pool.query("delete from app_registry where app_id = $1", [app]);
  console.log(
    "\nLecture : `att.*` est le temps d'attente du verrou SEUL, mesuré pendant la charge.\n" +
    "Un `refus` non nul signifie qu'une attente a dépassé " + STRATEGIE_VERROU.delaiMs + " ms " +
    STRATEGIE_VERROU.tentatives + " fois de suite : le lot n'est pas écrit, il est rejouable.\n",
  );
  if (process.env.BENCH_JSON) console.log(JSON.stringify(resultats, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error("[bench-verrou] échec", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
