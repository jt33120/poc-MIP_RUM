#!/usr/bin/env node
// Banc local du collector — porte go/no-go de P2, en APPROXIMATION LOCALE.
//
// POURQUOI CE PILOTE EXISTE. La porte de P2 se juge sur staging : collector
// Railway (Amsterdam) → Neon (Francfort), ~9 ms par aller-retour SQL. Tant que
// Neon est suspendu (quota épuisé le 24/09/2026), ce trajet n'existe pas. On en
// reproduit ici la seule grandeur qui compte pour le verrou d'application : la
// LATENCE par aller-retour, injectée par toxiproxy entre le collector et un
// Postgres 17 de conteneur. Le reste (CPU de Neon, pooler PgBouncer, disque,
// réseau Railway) n'est PAS reproduit : c'est la limite du chiffre, dite dans
// docs/operations/banc-collecteur-2026-09-24.md.
//
// CE QU'IL FAIT, dans l'ordre, et défait toujours à la fin :
//   1. réseau Docker + Postgres 17 (pg_stat_statements chargé) SANS port publié,
//      + toxiproxy qui publie le SEUL port réservé du banc (55452) vers lui ;
//   2. base `mip_rum_bench` migrée par LE migrateur de production
//      (`node services/scheduler/migrate.mjs`), une app de banc dotée d'une clé ;
//   3. pour chaque condition (sans latence, puis avec) : toxiques posés, A/R à
//      vide mesuré, collector démarré (le vrai `services/collector/server.mjs`,
//      REQUIRE_API_KEY=true, pool de 8 comme en production) avec la sonde
//      préchargée (`sonde-pg-preload.mjs`), puis `scripts/load-bench.mjs` à
//      débits IMPOSÉS (boucle ouverte, arrivées poissonniennes) et à
//      concurrences fixes (saturation), sur UN SEUL app_id ; enfin
//      `scripts/bench-verrou-p81.mjs` en processus, pour isoler le verrou ;
//   4. écrit le relevé complet (JSON) et en imprime la synthèse.
//
// « Sans latence » passe AUSSI par toxiproxy, toxique retiré : les deux
// conditions ne diffèrent que par la latence injectée, et le port réservé
// reste le seul port publié.
//
// GARDES : aucune variable DATABASE_URL, BENCH_DATABASE_URL ni PG* du poste
// n'atteint un processus enfant (le `.env` du poste vise la production) ; la
// base est construite ici, sur 127.0.0.1, dans des conteneurs nommés par le port.
//
// Usage :
//   node scripts/bench/banc-collecteur-local.mjs
// Réglages (défauts entre crochets) :
//   BANC_PORT [55452]  BANC_PORT_COLLECTOR [45452]  BANC_DUREE_S [30]  BANC_DUREE_FERMEE_S [15]
//   BANC_LOTS_MIN [40]  (une marche à bas débit dure assez pour porter au moins ce nombre de lots)
//   BANC_DEBITS_SANS [1,2,5,10,20,40,60]   BANC_DEBITS_AVEC [0.5,1,2,3,4,5,6]   (lots/s)
//   BANC_CONCURRENCES [1,4,16]   BANC_LATENCE_AMONT_MS [3]   BANC_LATENCE_AVAL_MS [3]
//   BANC_ALLER_RETOUR_CIBLE_MS [9]
//   BANC_VERROU_WRITERS [1,4,16]  BANC_VERROU_LOTS [200]  BANC_SORTIE [<tmp>/banc-collecteur-<t>.json]
//   BANC_GARDER=1 : laisser les conteneurs en place (débogage).
//
// LA LATENCE SE CALE SUR L'ALLER-RETOUR MESURÉ, PAS SUR LE RÉGLAGE NOMINAL.
// toxiproxy n'accepte que des millisecondes entières, et sous Docker Desktop
// (macOS) chaque toxique ajoute ≈ 1,5 à 2,5 ms à sa valeur (minuteries de la VM,
// relais de port) : 4 + 5 ms donnaient 13 ms mesurés au `select 1`, 3 + 3 ms en
// donnent 9 à 9,7 (calibration du 24/09/2026). Ce qui compte pour le verrou est
// l'aller-retour que voit le collector ; il est mesuré et écrit dans le relevé
// à chaque condition, et le pilote prévient s'il s'écarte de plus de 25 % de
// la cible (9 ms : Amsterdam ↔ Francfort, 8 à 10 ms selon le plan).
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { analyser, percentile } from "./sonde-pg.mjs";
import { echantillonner, resumer } from "./echantillonner-verrou.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const liste = (cle, defaut) => (process.env[cle] ?? defaut).split(",").map(Number).filter((n) => n > 0);

const PORT = Number(process.env.BANC_PORT ?? 55452);
const PORT_COLLECTOR = Number(process.env.BANC_PORT_COLLECTOR ?? PORT - 10_000);
const NOM = `banc-collecteur-${PORT}`;
const CONTENEUR_PG = `${NOM}-pg`;
const CONTENEUR_TOXI = `${NOM}-toxi`;
const BASE = "mip_rum_bench";
const URL_BANC = `postgres://postgres:postgres@127.0.0.1:${PORT}/${BASE}`;
const APP = "banc-p2";
const DUREE_S = Number(process.env.BANC_DUREE_S ?? 30);
const DUREE_FERMEE_S = Number(process.env.BANC_DUREE_FERMEE_S ?? 15);
const LOTS_MIN = Number(process.env.BANC_LOTS_MIN ?? 40);
const CONCURRENCES = liste("BANC_CONCURRENCES", "1,4,16");
const CIBLE_AR_MS = Number(process.env.BANC_ALLER_RETOUR_CIBLE_MS ?? 9);
const CONDITIONS = [
  { nom: "sans latence", amontMs: 0, avalMs: 0, debits: liste("BANC_DEBITS_SANS", "1,2,5,10,20,40,60"), cible: null },
  {
    nom: "avec latence",
    amontMs: Number(process.env.BANC_LATENCE_AMONT_MS ?? 3),
    avalMs: Number(process.env.BANC_LATENCE_AVAL_MS ?? 3),
    debits: liste("BANC_DEBITS_AVEC", "0.5,1,2,3,4,5,6"),
    cible: CIBLE_AR_MS,
  },
];
const SORTIE = process.env.BANC_SORTIE ?? join(tmpdir(), `banc-collecteur-${Date.now()}.json`);
const TRAVAIL = `${SORTIE}.d`;

/** L'environnement des enfants : celui du poste, SANS aucune cible Postgres. */
function envPropre(extra = {}) {
  const env = { ...process.env };
  for (const cle of Object.keys(env)) {
    if (cle.startsWith("PG") || /DATABASE_URL$/.test(cle) || cle === "NODE_ENV" || cle.startsWith("RAILWAY_")) delete env[cle];
  }
  return { ...env, ...extra };
}

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql, base = BASE) => docker("exec", CONTENEUR_PG, "psql", "-U", "postgres", "-d", base, "-v", "ON_ERROR_STOP=1", "-Atc", sql);
const toxi = (...args) => docker("exec", CONTENEUR_TOXI, "/toxiproxy-cli", ...args);
const journal = (...m) => console.error(`[banc] ${m.join(" ")}`);

// ─────────────────────────────── Montage ────────────────────────────────────

function existe(nom) {
  return docker("ps", "-a", "--filter", `name=^${nom}$`, "--format", "{{.Names}}") === nom;
}

async function monter() {
  for (const nom of [CONTENEUR_PG, CONTENEUR_TOXI]) {
    if (existe(nom)) throw new Error(`le conteneur ${nom} existe déjà : un autre banc tourne sur ce port (ou BANC_GARDER=1 l'a laissé)`);
  }
  docker("network", "create", NOM);
  docker("run", "-d", "--rm", "--name", CONTENEUR_PG, "--network", NOM, "-e", "POSTGRES_PASSWORD=postgres",
    "postgres:17", "-c", "shared_preload_libraries=pg_stat_statements", "-c", "max_connections=200");
  docker("run", "-d", "--rm", "--name", CONTENEUR_TOXI, "--network", NOM, "-p", `127.0.0.1:${PORT}:${PORT}`,
    "ghcr.io/shopify/toxiproxy");
  for (let i = 0; ; i++) {
    try {
      // `pg_isready` répond pendant l'initdb (serveur temporaire) : on exige une vraie requête.
      psql("select 1", "postgres");
      break;
    } catch (err) {
      if (i > 60) throw err;
      await dormir(1000);
    }
  }
  toxi("create", "-l", `0.0.0.0:${PORT}`, "-u", `${CONTENEUR_PG}:5432`, "pg");
  psql(`create database ${BASE}`, "postgres");
  psql("create extension if not exists pg_stat_statements");
  journal("migration par le migrateur de production");
  execFileSync(process.execPath, ["services/scheduler/migrate.mjs"], {
    cwd: RACINE, env: envPropre({ DATABASE_URL: URL_BANC }), stdio: ["ignore", "ignore", "inherit"],
  });
  // Une app dotée d'une clé : le collector tourne sous REQUIRE_API_KEY=true,
  // comme `railway.ts` le prévoit. La clé ne sort pas de ce processus.
  const cle = `mip_${randomBytes(16).toString("hex")}`;
  const empreinte = createHash("sha256").update(cle).digest("hex");
  psql(`insert into app_registry (app_id, name, active, api_key_hash) values ('${APP}', 'Banc P2', true, '${empreinte}')`);
  return cle;
}

function demonter() {
  if (process.env.BANC_GARDER === "1") return journal(`conteneurs laissés en place (${NOM}-*)`);
  for (const nom of [CONTENEUR_TOXI, CONTENEUR_PG]) {
    try { docker("stop", "-t", "2", nom); } catch { /* déjà parti */ }
  }
  try { docker("network", "rm", NOM); } catch { /* déjà parti */ }
}

function poserLatence(amontMs, avalMs) {
  for (const n of ["lat_amont", "lat_aval"]) {
    try { toxi("toxic", "remove", "-n", n, "pg"); } catch { /* absent */ }
  }
  if (amontMs > 0) toxi("toxic", "add", "-n", "lat_amont", "-t", "latency", "-u", "-a", `latency=${amontMs}`, "pg");
  if (avalMs > 0) toxi("toxic", "add", "-n", "lat_aval", "-t", "latency", "-d", "-a", `latency=${avalMs}`, "pg");
}

/** Aller-retour SQL à vide (`select 1`), par le même chemin que le collector. */
async function mesurerAllerRetour() {
  const c = new pg.Client({ connectionString: URL_BANC });
  await c.connect();
  try {
    for (let i = 0; i < 10; i++) await c.query("select 1");
    const v = [];
    for (let i = 0; i < 200; i++) {
      const t = performance.now();
      await c.query("select 1");
      v.push(performance.now() - t);
    }
    return { p50: +percentile(v, 50).toFixed(2), p95: +percentile(v, 95).toFixed(2) };
  } finally {
    await c.end();
  }
}

// ─────────────────────────────── Collector ──────────────────────────────────

async function demarrerCollector(etiquette) {
  const fichierSonde = join(TRAVAIL, `sonde-${etiquette}.json`);
  const fd = openSync(join(TRAVAIL, `collector-${etiquette}.log`), "a");
  const proc = spawn(process.execPath, ["--import", "./scripts/bench/sonde-pg-preload.mjs", "services/collector/server.mjs"], {
    cwd: RACINE,
    env: envPropre({
      DATABASE_URL: URL_BANC,
      PORT: String(PORT_COLLECTOR),
      PGPOOL_MAX: "8",
      REQUIRE_API_KEY: "true",
      // Le compteur durable reste interrogé (1 A/R par requête, hors verrou),
      // mais ne doit pas couper le banc : 600/min par défaut = 10 lots/s.
      RATE_LIMIT_PER_MIN: "100000000",
      LOG_LEVEL: "info",
      BENCH_SONDE_FICHIER: fichierSonde,
    }),
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const sortie = new Promise((r) => proc.once("exit", r));
  for (let i = 0; ; i++) {
    if (proc.exitCode != null) throw new Error(`le collector s'est arrêté au démarrage (voir ${TRAVAIL})`);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT_COLLECTOR}/health`);
      if (res.ok) break;
    } catch { /* pas encore à l'écoute */ }
    if (i > 100) throw new Error("le collector ne répond pas sur /health");
    await dormir(200);
  }
  return {
    proc,
    async relever() {
      rmSync(fichierSonde, { force: true });
      proc.kill("SIGUSR2");
      for (let i = 0; !existsSync(fichierSonde); i++) {
        if (i > 200) throw new Error("la sonde du collector n'a pas répondu à SIGUSR2");
        await dormir(25);
      }
      return JSON.parse(readFileSync(fichierSonde, "utf8"));
    },
    async arreter() {
      proc.kill("SIGTERM");
      await sortie;
      return proc.exitCode;
    },
  };
}

// ─────────────────────────────── Mesures ────────────────────────────────────

let runId = 0;
function lancerNode(script, env) {
  return new Promise((ok, ko) => {
    const enfant = spawn(process.execPath, [script], { cwd: RACINE, env: envPropre(env), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    enfant.stdout.on("data", (d) => { out += d; });
    enfant.stderr.on("data", (d) => { err += d; });
    enfant.once("exit", (code) => (code === 0 ? ok(out) : ko(new Error(`${script} : sortie ${code}\n${err}`))));
  });
}

async function charge(cle, env) {
  const out = await lancerNode("scripts/load-bench.mjs", {
    ENDPOINT: `http://127.0.0.1:${PORT_COLLECTOR}/v1/traces`,
    APP, API_KEY: cle, DB_PHASE: "0", ERROR_RATE: "0.02", RUN_ID: String(++runId), SEED: String(runId), ...env,
  });
  return JSON.parse(out).load;
}

function pgssRemettre() {
  psql("select pg_stat_statements_reset()");
}

/**
 * Ce que la base a exécuté pendant la phase (hors ces requêtes de relevé).
 *
 * `execTravailSousVerrouMs` = temps d'exécution SERVEUR des requêtes du lot,
 * moins l'attente du verrou (le temps de `pg_advisory_xact_lock` EST
 * l'attente) et moins ce qui tourne hors verrou (débit, registre). C'est la
 * borne basse de ce que tiendrait le verrou si le lot entier partait en UN
 * aller-retour (le repli « fonction SQL » du plan). Le COMMIT (vidage du WAL)
 * n'y est pas : pg_stat_statements ne chronomètre pas la fin de transaction.
 */
function pgssLire() {
  const filtre = `dbid = (select oid from pg_database where datname = '${BASE}') and query not ilike '%pg_stat_statements%' and query not ilike '%from pg_locks%'`;
  const [appels, execMs, horsVerrouMs, attenteMs] = psql(
    `select coalesce(sum(calls), 0), coalesce(sum(total_exec_time), 0),
            coalesce(sum(total_exec_time) filter (where query ilike '%rate_check%' or query ilike '%from app_registry%'), 0),
            coalesce(sum(total_exec_time) filter (where query ilike '%pg_advisory_xact_lock%'), 0)
       from pg_stat_statements where ${filtre}`,
  ).split("|").map(Number);
  const top = psql(
    `select calls, round(total_exec_time::numeric, 1), left(regexp_replace(query, '\\s+', ' ', 'g'), 70)
       from pg_stat_statements where ${filtre} order by total_exec_time desc limit 12`,
  ).split("\n").filter(Boolean).map((l) => {
    const [n, ms, q] = l.split("|");
    return { appels: Number(n), totalMs: Number(ms), requete: q };
  });
  return {
    appels,
    execMs: +execMs.toFixed(1),
    attenteVerrouServeurMs: +attenteMs.toFixed(1),
    execTravailSousVerrouMs: +(execMs - horsVerrouMs - attenteMs).toFixed(1),
    top,
  };
}

async function phase(collector, cle, rtt, env, etiquette) {
  await collector.relever(); // vide ce qui précède (chauffe, phase précédente)
  pgssRemettre();
  // L'échantillonneur SERVEUR tourne à côté de la sonde client : c'est la
  // méthode qui restera sur staging, où la sonde ne peut pas être préchargée.
  // Sa connexion passe par le même proxy (donc par la même latence).
  const echClient = new pg.Client({ connectionString: URL_BANC, application_name: "mip-banc-echantillonneur" });
  await echClient.connect();
  let finCharge = false;
  const ech = echantillonner(echClient, { app: APP, periodeMs: 5, arret: () => finCharge });
  let load;
  try {
    load = await charge(cle, env);
  } finally {
    finCharge = true;
  }
  const echantillons = await ech.finally(() => echClient.end());
  const releve = await collector.relever();
  const pgss = pgssLire();
  const sonde = analyser(releve, { depuis: load.window.startEpochMs, jusqua: load.window.endEpochMs, rttMs: rtt.p50 });
  const serveur = resumer(echantillons, { depuis: load.window.startEpochMs, jusqua: load.window.endEpochMs });
  const requetesSonde = releve.lots.reduce((s, l) => s + l.requetes, 0) + releve.horsTransaction.length;
  const r = {
    etiquette,
    load,
    sonde,
    echantillonneurServeur: serveur,
    pgss: {
      ...pgss,
      requetesVuesParLaSonde: requetesSonde,
      travailServeurParLotMs: sonde.lots ? +(pgss.execTravailSousVerrouMs / sonde.lots).toFixed(2) : null,
    },
  };
  journal(`${etiquette.padEnd(24)} lots/s=${String(sonde.lotsParSeconde).padStart(6)} util=${(100 * sonde.utilisation).toFixed(1).padStart(5)} %`,
    `(pg_locks ${serveur.utilisation == null ? "n/d" : (100 * serveur.utilisation).toFixed(1)} % sur ${serveur.echantillons} éch., file moy. ${serveur.fileMoyenne})`,
    `tx p50/p95=${sonde.transactionMs.p50}/${sonde.transactionMs.p95} ms`,
    `attente p95=${sonde.attenteVerrouMs.p95} ms tenu p50=${sonde.tenuMs.p50} ms`,
    `A/R=${sonde.allersRetoursParLot.dansTransaction.p50}+${sonde.allersRetoursParLot.horsTransaction}`,
    `serveur/lot=${r.pgss.travailServeurParLotMs} ms`,
    `statuts=${JSON.stringify(load.statusCounts)}`,
    `(pgss ${pgss.appels} = sonde ${requetesSonde} ?)`);
  return r;
}

async function benchVerrou() {
  const out = await lancerNode("scripts/bench-verrou-p81.mjs", {
    BENCH_DATABASE_URL: URL_BANC,
    BENCH_WRITERS: process.env.BANC_VERROU_WRITERS ?? "1,4,16",
    BENCH_LOTS: process.env.BANC_VERROU_LOTS ?? "200",
    BENCH_BUDGET: "collector",
    BENCH_SONDE_PAUSE_MS: "100",
    BENCH_POOL_MAX: "24",
    BENCH_JSON: "1",
  });
  const debutJson = out.indexOf("\n[");
  return { tableau: out.slice(0, debutJson).trim(), resultats: JSON.parse(out.slice(debutJson)) };
}

// ─────────────────────────────── Programme ──────────────────────────────────

async function main() {
  execFileSync("mkdir", ["-p", TRAVAIL]);
  const releve = { date: new Date().toISOString(), port: PORT, app: APP, dureeS: DUREE_S, dureeFermeeS: DUREE_FERMEE_S, conditions: [] };
  let collector = null;
  const arret = () => { try { collector?.proc.kill("SIGKILL"); } catch { /* */ } demonter(); process.exit(130); };
  process.once("SIGINT", arret);
  try {
    journal(`montage : Postgres 17 derrière toxiproxy sur 127.0.0.1:${PORT}`);
    const cle = await monter();
    releve.postgres = psql("show server_version");
    for (const cond of CONDITIONS) {
      poserLatence(cond.amontMs, cond.avalMs);
      const rtt = await mesurerAllerRetour();
      journal(`— ${cond.nom} : latence ${cond.amontMs} + ${cond.avalMs} ms, A/R à vide p50 ${rtt.p50} ms`);
      if (cond.cible && Math.abs(rtt.p50 - cond.cible) / cond.cible > 0.25) {
        journal(`ATTENTION : A/R mesuré ${rtt.p50} ms, loin de la cible ${cond.cible} ms — recaler BANC_LATENCE_*_MS`);
      }
      const etiquette = cond.nom.replace(/\s+/g, "-");
      collector = await demarrerCollector(etiquette);
      // Chauffe : ouvre les 8 connexions du pool et remplit les caches
      // (registre d'apps, colonnes, présence des barrières) avant toute mesure.
      await charge(cle, { CONCURRENCY: "8", DURATION_S: "3" });
      const phases = [];
      for (const debit of cond.debits) {
        // À 0,5 lot/s, 30 s ne font que 15 lots : un p95 sur 15 valeurs est le max.
        const duree = Math.max(DUREE_S, Math.ceil(LOTS_MIN / debit));
        phases.push(await phase(collector, cle, rtt, { RATE: String(debit), DURATION_S: String(duree) }, `ouvert ${debit} lots/s`));
      }
      for (const c of CONCURRENCES) {
        phases.push(await phase(collector, cle, rtt, { CONCURRENCY: String(c), DURATION_S: String(DUREE_FERMEE_S) }, `fermé ×${c}`));
      }
      const sortieCollector = await collector.arreter();
      collector = null;
      journal(`collector arrêté (code ${sortieCollector}) ; banc du verrou en processus`);
      const verrou = await benchVerrou();
      console.error(verrou.tableau);
      releve.conditions.push({ ...cond, allerRetourVideMs: rtt, phases, benchVerrou: verrou, sortieCollector });
    }
  } finally {
    if (collector) await collector.arreter().catch(() => {});
    demonter();
  }
  writeFileSync(SORTIE, JSON.stringify(releve, null, 2));
  journal(`relevé complet : ${SORTIE}`);
}

main().catch((err) => {
  console.error("[banc] échec :", err?.stack ?? err);
  process.exit(1);
});
