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
//
// Réglages (P2, porte go/no-go du collector — tous optionnels) :
//   BENCH_LOTS             [200]      lots par passe
//   BENCH_WRITERS          [1,10,50]  écrivains simultanés, un niveau par passe
//   BENCH_APPS_REPARTIES   [5]        applications du scénario « réparti »
//   BENCH_POOL_MAX         [60]       connexions du pool de banc
//   BENCH_BUDGET           [console]  console = stratégie par défaut (5 s × 3) ;
//                                     collector = budget de requête du collector
//                                     (1,5 s × 2, `BUDGET_REQUETE`) — celui qu'il faut
//                                     juger pour P2, puisque c'est lui qui écrira
//   BENCH_SONDE_PAUSE_MS   [0]        pause entre deux passages de la sonde d'attente.
//                                     À 0, la sonde reprend le verrou en boucle : sans
//                                     latence c'est négligeable, mais derrière ~9 ms
//                                     d'aller-retour elle le TIENT un A/R par passage
//                                     (≈ 25 % du temps à vide) et fausse ce qu'elle mesure
//   BENCH_MIGRER           [auto]     auto = migrer SEULEMENT une base vierge. Une base
//                                     montée par le migrateur de production
//                                     (`node services/scheduler/migrate.mjs`, registre
//                                     `schema_migration`) n'est pas re-migrée à la main :
//                                     rejouer `schema.sql` et les v* par-dessus n'est pas
//                                     ce que fait la production. 1 = toujours, 0 = jamais.
//
// La SONDE CLIENT (`scripts/bench/sonde-pg.mjs`) complète la sonde d'attente :
// sur les lots des écrivains eux-mêmes, elle chronomètre la tenue du verrou
// (réponse du verrou → réponse du COMMIT), l'utilisation (tenue cumulée / durée
// de la passe) et compte les allers-retours SQL par lot.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { flattenOtlp } from "../packages/backend/shared/otlp.mjs";
import { writeRows } from "../packages/backend/lib/pg-ingest.mjs";
import { BUDGET_REQUETE } from "../packages/backend/lib/receiver.mjs";
import { STRATEGIE_VERROU, withAppIngestTransaction } from "../packages/backend/lib/privacy-barriere.mjs";
import { analyser, installerSonde, maintenant } from "./bench/sonde-pg.mjs";

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
const APPS_REPARTIES = Number(process.env.BENCH_APPS_REPARTIES ?? 5);
const PAUSE_SONDE_MS = Number(process.env.BENCH_SONDE_PAUSE_MS ?? 0);
const BUDGET = process.env.BENCH_BUDGET === "collector" ? "collector" : "console";
/** Stratégie d'attente passée à `writeRows` et à la sonde : `{}` = défaut du module. */
const VERROU = BUDGET === "collector" ? BUDGET_REQUETE.verrou : {};
const DELAI_MS = VERROU.delaiVerrouMs ?? STRATEGIE_VERROU.delaiMs;
const TENTATIVES = VERROU.tentatives ?? STRATEGIE_VERROU.tentatives;

const pool = new pg.Pool({ connectionString: URL_BASE, max: Number(process.env.BENCH_POOL_MAX ?? 60) });
const sondeClient = installerSonde(pg);

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
        await writeRows(pool, lot(app), { verrou: VERROU });
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
        await withAppIngestTransaction(pool, apps[0], async () => {}, VERROU);
        attentes.push(performance.now() - t0);
      } catch (err) {
        if (err?.name === "ErreurVerrouIngestion") refus++;
        else throw err;
      }
      if (PAUSE_SONDE_MS > 0) await new Promise((r) => setTimeout(r, PAUSE_SONDE_MS));
    }
  })();

  sondeClient.vider();
  const debutMur = maintenant();
  const debut = performance.now();
  await Promise.all(Array.from({ length: writers }, (_, i) => ecrivain(i)));
  const duree = performance.now() - debut;
  const finMur = maintenant();
  sonder = false;
  await sonde;
  // Vue des ÉCRIVAINS (la sonde d'attente fait 4 requêtes par passage :
  // `analyser` l'écarte). Réparti sur N apps, `utilisation` additionne N
  // verrous distincts : c'est une occupation cumulée, qui peut dépasser 1.
  const client = analyser(sondeClient.vider(), { depuis: debutMur, jusqua: finMur });

  return {
    writers,
    apps: apps.length,
    duree,
    debit: (LOTS / duree) * 1000,
    latence: { p50: percentile(latences, 50), p95: percentile(latences, 95), max: percentile(latences, 100) },
    attente: { p50: percentile(attentes, 50), p95: percentile(attentes, 95), max: percentile(attentes, 100) },
    refus,
    tenu: client.tenuMs,
    transaction: client.transactionMs,
    attenteEcrivains: client.attenteVerrouMs,
    utilisation: client.utilisation,
    allersRetours: client.allersRetoursParLot.dansTransaction,
    sequenceType: client.sequenceType,
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
    ms(r.tenu.p50).padStart(10),
    `${(100 * r.utilisation).toFixed(0)} %`.padStart(6),
    String(r.allersRetours.p50 ?? "n/d").padStart(4),
    `${r.debit.toFixed(0)}/s`.padStart(9),
    String(r.refus).padStart(6),
  ].join(" ");
}

/**
 * Une base montée par le migrateur de production porte son registre : on ne
 * la re-migre pas à la main (BENCH_MIGRER=auto, défaut). Une base vierge, si.
 */
async function fautIlMigrer() {
  const choix = process.env.BENCH_MIGRER ?? "auto";
  if (choix === "1") return true;
  if (choix === "0") return false;
  const { rows } = await pool.query("select to_regclass('public.schema_migration') is not null as ok");
  return !rows[0].ok;
}

async function main() {
  if (await fautIlMigrer()) {
    for (const f of migrations()) await pool.query(readFileSync(f, "utf8"));
  } else {
    console.log("[bench-verrou] base déjà migrée (registre schema_migration) : aucune migration rejouée");
  }
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
  console.log(`lots par passe : ${LOTS} · budget : ${BUDGET} · lock_timeout : ${DELAI_MS} ms · tentatives : ${TENTATIVES} · pause de la sonde : ${PAUSE_SONDE_MS} ms`);
  console.log(
    "\n" + "scénario".padEnd(26) + " " + "wr".padStart(3) + " " + "apps".padStart(5) + " " +
    "lat.p50".padStart(10) + " " + "lat.p95".padStart(10) + " " +
    "att.p50".padStart(10) + " " + "att.p95".padStart(10) + " " + "att.max".padStart(10) + " " +
    "tenu.p50".padStart(10) + " " + "util.".padStart(6) + " " + "A/R".padStart(4) + " " +
    "débit".padStart(9) + " " + "refus".padStart(6),
  );
  console.log("-".repeat(130));

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
    "`tenu` : réponse du verrou → réponse du COMMIT, sur les lots des écrivains (sonde client) ;\n" +
    "`util.` : tenue cumulée / durée de la passe ; `A/R` : allers-retours SQL par lot, de BEGIN à COMMIT.\n" +
    "Un `refus` non nul signifie qu'une attente a dépassé " + DELAI_MS + " ms " +
    TENTATIVES + " fois de suite : le lot n'est pas écrit, il est rejouable.\n",
  );
  if (process.env.BENCH_JSON) console.log(JSON.stringify(resultats, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error("[bench-verrou] échec", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
