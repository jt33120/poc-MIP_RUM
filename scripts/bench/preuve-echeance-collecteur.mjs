#!/usr/bin/env node
// Preuve de l'ÉCHÉANCE DURE du collector (P2) : un 503 rendu = rien de commis.
//
// POURQUOI CE SCRIPT. Le relais de la console abandonne à 8 s et rend 503 ; le
// SDK rejoue. Un collector qui COMMITTE après ce 503 écrit le lot deux fois —
// et les logs n'ont pas de clé naturelle pour dédoublonner. Les tests unitaires
// prouvent la mécanique sur un faux pool ; ici on la prouve sur un VRAI
// Postgres 17, derrière toxiproxy, avec le VRAI `services/collector/server.mjs`
// (REQUIRE_API_KEY=true, pool de production) : latence de 10 s injectée entre
// le collector et la base, avant ou PENDANT la transaction.
//
// L'INVARIANT VÉRIFIÉ, requête par requête, 15 s APRÈS la dernière (le temps
// qu'un COMMIT retardé arrive, s'il était parti) :
//   - statut 503  ⇒ AUCUNE ligne en base pour ce lot, et réponse en < 5 s ;
//   - statut 200  ⇒ les lignes sont là (la latence est tombée après le COMMIT).
// La lecture finale passe par `docker exec psql`, pas par le proxy.
//
// MONTAGE (défait à la fin, même en échec) : réseau Docker, Postgres 17 SANS
// port publié, toxiproxy qui publie son proxy sur 127.0.0.1:55461 (le SEUL
// chemin vers la base : migration et collector) et son API sur 55460. L'API
// est appelée en HTTP, pas par `docker exec` : un `docker exec` coûte ~150 ms,
// plus que la transaction entière — la latence tomberait toujours APRÈS le
// COMMIT, et le balayage « pendant la transaction » ne prouverait rien.
// Aucune variable DATABASE_URL / PG* / RAILWAY_* / NODE_ENV du poste n'atteint
// un enfant (le `.env` vise la production).
//
// Usage : node scripts/bench/preuve-echeance-collecteur.mjs
// Réglages : PREUVE_PORT_API [55460]  PREUVE_PORT_TOXI [55461]
//            PREUVE_PORT_COLLECTOR [45461]  PREUVE_GARDER=1 (débogage)
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "mip_rum_echeance";
const PORT_API = Number(process.env.PREUVE_PORT_API ?? 55460);
const PORT_TOXI = Number(process.env.PREUVE_PORT_TOXI ?? 55461);
const PORT_COLLECTOR = Number(process.env.PREUVE_PORT_COLLECTOR ?? 45461);
const NOM = `preuve-echeance-${PORT_TOXI}`;
const API = `http://127.0.0.1:${PORT_API}`;
const URL_BASE = `postgres://postgres:postgres@127.0.0.1:${PORT_TOXI}/${BASE}`;
const CONTENEUR_PG = `${NOM}-pg`;
const CONTENEUR_TOXI = `${NOM}-toxi`;
const APP = "preuve-echeance";
const LATENCE_MS = 10_000;
const PLAFOND_503_MS = 5_000;
const ATTENTE_FINALE_MS = 15_000;
// Instants (ms après l'envoi) où la latence tombe. Avec ~9 ms d'aller-retour
// de fond, un lot fait une douzaine d'allers-retours, plus les connexions à
// rouvrir après un cas précédent : 0 à 400 ms couvre les gardes, le verrou,
// les insertions, le COMMIT, puis l'après-COMMIT (200 attendu).
const BALAYAGE = (process.env.PREUVE_BALAYAGE ?? "0,20,40,60,80,100,120,140,170,200,250,300,400")
  .split(",").map(Number).filter((n) => n >= 0);
const TRAVAIL = mkdtempSync(join(tmpdir(), "preuve-echeance-"));

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql, base = BASE) => docker("exec", CONTENEUR_PG, "psql", "-U", "postgres", "-d", base, "-v", "ON_ERROR_STOP=1", "-Atc", sql);
async function api(methode, chemin, corps) {
  const r = await fetch(`${API}${chemin}`, {
    method: methode, headers: { "content-type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined,
  });
  if (!r.ok && !(methode === "DELETE" && r.status === 404)) throw new Error(`toxiproxy ${methode} ${chemin} : ${r.status} ${await r.text()}`);
}
const journal = (...m) => console.error(`[preuve] ${m.join(" ")}`);

function envPropre(extra = {}) {
  const env = { ...process.env };
  for (const cle of Object.keys(env)) {
    if (cle.startsWith("PG") || /DATABASE_URL$/.test(cle) || cle === "NODE_ENV" || cle.startsWith("RAILWAY_") || cle === "MIP_E2E_TAMPON") delete env[cle];
  }
  return { ...env, ...extra };
}

// ─────────────────────────────── Montage ────────────────────────────────────

async function monter() {
  for (const nom of [CONTENEUR_PG, CONTENEUR_TOXI]) {
    if (docker("ps", "-a", "--filter", `name=^${nom}$`, "--format", "{{.Names}}") === nom) {
      throw new Error(`le conteneur ${nom} existe déjà (autre preuve en cours, ou PREUVE_GARDER=1)`);
    }
  }
  docker("network", "create", NOM);
  docker("run", "-d", "--rm", "--name", CONTENEUR_PG, "--network", NOM, "-e", "POSTGRES_PASSWORD=postgres", "postgres:17");
  docker("run", "-d", "--rm", "--name", CONTENEUR_TOXI, "--network", NOM,
    "-p", `127.0.0.1:${PORT_TOXI}:${PORT_TOXI}`, "-p", `127.0.0.1:${PORT_API}:8474`, "ghcr.io/shopify/toxiproxy");
  for (let i = 0; ; i++) {
    try {
      psql("select 1", "postgres");
      break;
    } catch (err) {
      if (i > 60) throw err;
      await dormir(1000);
    }
  }
  for (let i = 0; ; i++) {
    try {
      await api("POST", "/proxies", { name: "pg", listen: `0.0.0.0:${PORT_TOXI}`, upstream: `${CONTENEUR_PG}:5432` });
      break;
    } catch (err) {
      if (i > 30) throw err;
      await dormir(500);
    }
  }
  psql(`create database ${BASE}`, "postgres");
  journal("migration par le migrateur de production (par le proxy, sans toxique)");
  execFileSync(process.execPath, ["services/scheduler/migrate.mjs"], {
    cwd: RACINE,
    env: envPropre({ DATABASE_URL: URL_BASE }),
    stdio: ["ignore", "ignore", "inherit"],
  });
  const cle = `mip_${randomBytes(16).toString("hex")}`;
  const empreinte = createHash("sha256").update(cle).digest("hex");
  psql(`insert into app_registry (app_id, name, active, api_key_hash) values ('${APP}', 'Preuve échéance', true, '${empreinte}')`);
  return cle;
}

function demonter() {
  if (process.env.PREUVE_GARDER === "1") return journal(`conteneurs laissés en place (${NOM}-*)`);
  for (const nom of [CONTENEUR_TOXI, CONTENEUR_PG]) {
    try { docker("stop", "-t", "2", nom); } catch { /* déjà parti */ }
  }
  try { docker("network", "rm", NOM); } catch { /* déjà parti */ }
}

const retirer = (nom) => api("DELETE", `/proxies/pg/toxics/${nom}`);

/** `aval` = base → collector (réponses retardées) ; `amont` = collector → base. */
async function poser(nom, sens, ms) {
  await retirer(nom);
  await api("POST", "/proxies/pg/toxics", {
    name: nom, type: "latency", stream: sens === "amont" ? "upstream" : "downstream", toxicity: 1, attributes: { latency: ms },
  });
}

// ─────────────────────────────── Collector ──────────────────────────────────

async function demarrerCollector() {
  const fichier = join(TRAVAIL, "collector.log");
  const fd = openSync(fichier, "a");
  const proc = spawn(process.execPath, ["services/collector/server.mjs"], {
    cwd: RACINE,
    env: envPropre({
      DATABASE_URL: URL_BASE,
      PORT: String(PORT_COLLECTOR),
      REQUIRE_API_KEY: "true",
      RATE_LIMIT_PER_MIN: "100000",
      LOG_LEVEL: "info",
    }),
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const sortie = new Promise((r) => proc.once("exit", r));
  for (let i = 0; ; i++) {
    if (proc.exitCode != null) throw new Error(`collector arrêté au démarrage (voir ${fichier})`);
    try {
      if ((await fetch(`http://127.0.0.1:${PORT_COLLECTOR}/health`)).ok) break;
    } catch { /* pas encore à l'écoute */ }
    if (i > 100) throw new Error("le collector ne répond pas sur /health");
    await dormir(200);
  }
  return { proc, fichier, arreter: async () => { proc.kill("SIGTERM"); await sortie; } };
}

// ─────────────────────────────── Lots ───────────────────────────────────────

const sv = (v) => ({ stringValue: v });
const attr = (key, v) => ({ key, value: sv(v) });
const nano = () => (BigInt(Date.now()) * 1_000_000n).toString();

function lotTraces(cle, session) {
  const t = nano();
  return JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", APP), attr("mip.api_key", cle)] },
      scopeSpans: [{ spans: [{
        name: "rum.pageview", traceId: randomBytes(16).toString("hex"), spanId: randomBytes(8).toString("hex"),
        startTimeUnixNano: t, endTimeUnixNano: t,
        attributes: [attr("mip.session_id", session), attr("mip.event_type", "pageview"), attr("mip.page", "/preuve")],
      }] }],
    }],
  });
}

function lotLogs(cle, marqueur) {
  return JSON.stringify({
    resourceLogs: [{
      resource: { attributes: [attr("mip.app_id", APP), attr("mip.api_key", cle)] },
      scopeLogs: [{ logRecords: [{ timeUnixNano: nano(), severityNumber: 9, severityText: "INFO", body: sv(marqueur) }] }],
    }],
  });
}

async function poster(signal, corps) {
  const t0 = performance.now();
  const r = await fetch(`http://127.0.0.1:${PORT_COLLECTOR}/v1/${signal}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: corps,
  });
  const ms = Math.round(performance.now() - t0);
  return { statut: r.status, ms, retryAfter: r.headers.get("retry-after"), corps: await r.text() };
}

/** Lignes présentes pour un lot, lues DIRECTEMENT (pas par le proxy). */
function lignes(cas) {
  if (cas.signal === "logs") return Number(psql(`select count(*) from rum_log where body = '${cas.cle}'`));
  return Number(psql(`select (select count(*) from rum_session where session_id = '${cas.cle}')
                           + (select count(*) from rum_pageview where session_id = '${cas.cle}')`));
}

// ─────────────────────────────── Programme ──────────────────────────────────

async function main() {
  const resultats = [];
  let collector = null;
  const arret = () => { try { collector?.proc.kill("SIGKILL"); } catch { /* */ } demonter(); process.exit(130); };
  process.once("SIGINT", arret);
  let echec = false;
  try {
    journal(`montage : Postgres 17 derrière toxiproxy (proxy 127.0.0.1:${PORT_TOXI}, API ${PORT_API})`);
    const cle = await monter();
    const versionPg = psql("show server_version");
    // Latence de fond ≈ 9 ms d'aller-retour (Railway ↔ Neon, cf. le banc du
    // 24/09) : la transaction dure alors ~100 ms, assez pour qu'une latence
    // posée « pendant » tombe au milieu, voire sur le COMMIT.
    await poser("fond_amont", "amont", 3);
    await poser("fond_aval", "aval", 3);
    collector = await demarrerCollector();
    // Chauffe : pool ouvert, registre, colonnes et barrières en cache.
    for (let i = 0; i < 3; i++) {
      const r = await poster("traces", lotTraces(cle, `chauffe-${i}`));
      if (r.statut !== 200) throw new Error(`chauffe : ${r.statut} ${r.corps}`);
    }
    await poster("logs", lotLogs(cle, "chauffe"));

    const scenarios = [
      { nom: "10 s aval dès le départ (réponses retardées)", signal: "traces", sens: "aval", apresMs: null },
      { nom: "10 s amont dès le départ (requêtes retardées)", signal: "traces", sens: "amont", apresMs: null },
      { nom: "10 s aval dès le départ", signal: "logs", sens: "aval", apresMs: null },
      // Posée PENDANT la requête : balaie la transaction jusqu'au COMMIT et
      // au-delà (les derniers pas doivent rendre 200, lignes présentes).
      ...BALAYAGE.map((ms) => ({ nom: `10 s aval posée à +${ms} ms`, signal: "traces", sens: "aval", apresMs: ms })),
      ...BALAYAGE.map((ms) => ({ nom: `10 s amont posée à +${ms} ms`, signal: "traces", sens: "amont", apresMs: ms })),
      ...BALAYAGE.map((ms) => ({ nom: `10 s aval posée à +${ms} ms`, signal: "logs", sens: "aval", apresMs: ms })),
    ];

    for (const sc of scenarios) {
      const cas = { ...sc, cle: `echeance-${sc.signal}-${randomBytes(6).toString("hex")}` };
      const corps = sc.signal === "logs" ? lotLogs(cle, cas.cle) : lotTraces(cle, cas.cle);
      if (sc.apresMs == null) await poser("dix_s", sc.sens, LATENCE_MS);
      const envoi = poster(sc.signal, corps);
      if (sc.apresMs != null) {
        await dormir(sc.apresMs);
        await poser("dix_s", sc.sens, LATENCE_MS);
      }
      const rep = await envoi;
      await retirer("dix_s");
      cas.reponse = rep;
      cas.fin = Date.now();
      resultats.push(cas);
      journal(`${sc.signal.padEnd(6)} ${sc.nom.padEnd(46)} → ${rep.statut} en ${rep.ms} ms`);
      // Le pool se remet (connexions détruites remplacées) avant le cas suivant.
      await dormir(300);
    }

    // Le collector sert à nouveau normalement une fois la latence retirée.
    const retour = await poster("traces", lotTraces(cle, `retour-${randomBytes(4).toString("hex")}`));
    journal(`retour à la normale : ${retour.statut} en ${retour.ms} ms`);

    const attente = Math.max(0, resultats.at(-1).fin + ATTENTE_FINALE_MS - Date.now());
    journal(`attente de ${Math.round(attente / 1000)} s : un COMMIT retardé aurait le temps d'arriver`);
    await dormir(attente);

    console.log(`\nPreuve de l'échéance dure — Postgres ${versionPg}, latence ${LATENCE_MS} ms, relevé ${ATTENTE_FINALE_MS / 1000} s après\n`);
    console.log("| signal | scénario | statut | réponse (ms) | retry-after | lignes en base | verdict |");
    console.log("|---|---|---|---|---|---|---|");
    for (const cas of resultats) {
      const n = lignes(cas);
      const { statut, ms, retryAfter } = cas.reponse;
      // 503 « issue inconnue » : le COMMIT est ARRIVÉ au serveur avant
      // l'échéance, et c'est sa RÉPONSE qui s'est perdue. Aucun protocole ne
      // tranche ce cas sans clé d'idempotence ; il est compté à part, jamais
      // maquillé en succès de la preuve.
      const inconnue = statut === 503 && /outcome unknown/.test(cas.reponse.corps);
      let verdict;
      if (statut === 503 && inconnue) verdict = ms < PLAFOND_503_MS && retryAfter === "2" ? `INCONNUE (${n ? "commis" : "annulé"})` : "ÉCHEC";
      else if (statut === 503) verdict = n === 0 && ms < PLAFOND_503_MS && retryAfter === "2" ? "OK" : "ÉCHEC";
      else if (statut === 200) verdict = n > 0 ? "OK" : "ÉCHEC";
      else verdict = "ÉCHEC";
      if (verdict === "ÉCHEC") echec = true;
      cas.lignes = n;
      cas.inconnue = inconnue;
      console.log(`| ${cas.signal} | ${cas.nom} | ${statut} | ${ms} | ${retryAfter ?? "—"} | ${n} | ${verdict} |`);
    }
    const n503 = resultats.filter((c) => c.reponse.statut === 503);
    const annules = n503.filter((c) => !c.inconnue);
    const max503 = Math.max(0, ...n503.map((c) => c.reponse.ms));
    console.log(`\n503 : ${n503.length}/${resultats.length} (dont ${n503.length - annules.length} à l'issue inconnue), le plus lent en ${max503} ms (plafond ${PLAFOND_503_MS}) ;`,
      `lignes commises derrière un 503 « annulé » : ${annules.reduce((s, c) => s + c.lignes, 0)} ;`,
      `derrière un 503 « inconnue » : ${n503.filter((c) => c.inconnue).reduce((s, c) => s + c.lignes, 0)} ; retour à la normale : ${retour.statut}.`);
    if (retour.statut !== 200) echec = true;
    const journalCollector = readFileSync(collector.fichier, "utf8");
    const inconnues = (journalCollector.match(/commit outcome unknown/g) ?? []).length;
    console.log(`COMMIT à l'issue inconnue (journal du collector) : ${inconnues}.`);
  } finally {
    if (collector) await collector.arreter().catch(() => {});
    demonter();
  }
  if (echec) {
    console.error("[preuve] ÉCHEC : l'invariant « 503 ⇒ rien de commis, en < 5 s » est violé");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[preuve] échec :", err?.stack ?? err);
  demonter();
  process.exit(1);
});
