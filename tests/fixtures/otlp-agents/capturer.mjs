#!/usr/bin/env node
// R11 — capture des corps OTLP RÉELLEMENT émis par les agents officiels de Java, de .NET
// et de Python, pour tests/integration/otlp-agents-java-dotnet-python-sql.test.ts.
//
// POURQUOI UN SCRIPT, quand Go, PHP et Ruby ont été capturés à la main le 01/10/2026 :
// Java et .NET ne tournent ni sur les postes ni dans le job `test:sql`, et une capture
// à la main ne se refait pas à l'identique. Ce script la rend rejouable, en CI
// (.github/workflows/agents-otlp.yml) comme sur un poste qui a Docker.
//
// CE QU'IL FAIT, pour chaque langage demandé :
//   1. construit l'application de `applications/<langage>/` (son Dockerfile fige la
//      version de l'agent et en vérifie l'empreinte) ;
//   2. la lance avec, pour toute configuration, le socle de la page Installer
//      (`socleOtel`, apps/console/lib/recettes-agents-otel.ts) : la clé d'API factice
//      remplace le repère, comme le ferait le client ; les adresses visent un relais local ;
//   3. l'appelle comme un navigateur porteur du SDK web (`traceparent`,
//      `tracestate: mip=s:<session>`) : GET /factures/42 (200, sous-appel HTTP),
//      POST /factures/42/payer (500, exception), GET /inconnue (404) ;
//   4. attend que les trois traces soient exportées, puis l'arrête (SIGTERM) ;
//   5. le relais garde chaque corps, octet pour octet, avec ses en-têtes, et le transmet
//      au collecteur de développement (`services/collector/dev-server.mjs`, clé exigée)
//      branché sur la base locale : l'agent lit la vraie réponse de la collecte.
// Puis il écrit les corps et met à jour `manifeste.json` (tailles, empreintes,
// versions), sans toucher aux corps des autres langages.
//
// LA BASE doit être migrée (`node services/scheduler/migrate.mjs`) et LOCALE : le script
// y inscrit trois applications de test (`r11-java`, `r11-dotnet`, `r11-python`) et y
// fait écrire la collecte. `exigerCibleLocale` refuse toute autre cible.
//
//   DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum \
//     node tests/fixtures/otlp-agents/capturer.mjs [java] [dotnet] [python] [--journaux <dossier>]
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as serveurTcp } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exigerCibleLocale } from "../../../scripts/lib/cible-locale.mjs";

const SCRIPT = "capturer-agents-otlp";
const URL_BASE = exigerCibleLocale(process.env.DATABASE_URL, { script: SCRIPT });
if (!URL_BASE) {
  console.error(`[${SCRIPT}] DATABASE_URL requis (base locale migrée).`);
  process.exit(2);
}

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..", "..");
const MANIFESTE = join(ICI, "manifeste.json");

// Imports après le garde-fou : rien ne se connecte avant lui.
const { default: pg } = await import("pg");
const { decompresserOtlp } = await import("../../../packages/backend/shared/otlp-corps.mjs");
const { decoderLogsProtobuf, decoderTracesProtobuf } = await import("../../../packages/backend/shared/otlp-protobuf.mjs");
const { REPERE_CLE_API, socleOtel } = await import("../../../apps/console/lib/recettes-agents-otel.ts");

/**
 * Ce qui distingue chaque langage. `rang` fixe ses identifiants de trace dans la suite
 * de ceux du manifeste (1 Go, 2 PHP, 3 Ruby). `pret` : la ligne du journal de
 * l'application qui dit qu'elle écoute — le port publié par Docker accepte les
 * connexions avant elle, et une requête de sonde serait exportée comme une trace.
 */
const LANGAGES = {
  java: {
    rang: 4,
    pret: /Started Factures in/,
    env: {},
    application:
      "Spring Boot 4 (Spring MVC, Tomcat) sous java -javaagent:opentelemetry-javaagent.jar -jar app.jar ; sous-appel par java.net.http.HttpClient ; journal SLF4J (Logback) ; l'exception sort du contrôleur",
    source: "applications/java/src/main/java/fr/mip/factures/Factures.java",
  },
  dotnet: {
    rang: 5,
    pret: /Now listening on/,
    // La recette de la page Installer le pose : sans dossier accessible en écriture,
    // le processus s'arrête au démarrage.
    env: { OTEL_DOTNET_AUTO_LOG_DIRECTORY: "/var/tmp/otel-dotnet" },
    application:
      "ASP.NET Core (API minimale) sous instrument.sh de l'instrumentation automatique ; sous-appel par HttpClient (IHttpClientFactory) ; journal ILogger ; l'exception sort du gestionnaire",
    source: "applications/dotnet/Program.cs",
  },
  python: {
    rang: 6,
    pret: /Running on/,
    env: {},
    application:
      "Flask sous opentelemetry-instrument flask --app app run ; sous-appel par urllib.request ; journal logging ; l'exception sort de la vue",
    source: "applications/python/app.py",
  },
};

const app = (l) => `r11-${l}`;
const cle = (l) => `r11-${l}-cle`;
const session = (l) => `r11-${l}-session`;
const trace = (l, k) => `e11c00000000000000000000000${LANGAGES[l].rang}000${k}`;
const parent = (l, k) => `e11c0${LANGAGES[l].rang}000000000${k}`;
const APPELS = [
  { k: 1, methode: "GET", chemin: "/factures/42", attendu: "GET /factures/42 → 200 (sous-appel HTTP GET /stock/42)" },
  { k: 2, methode: "POST", chemin: "/factures/42/payer", attendu: "POST /factures/42/payer → 500 (exception)" },
  { k: 3, methode: "GET", chemin: "/inconnue", attendu: "GET /inconnue → 404" },
];
const TABLES_APP = [
  "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask", "rum_breadcrumb",
  "rum_event", "rum_span", "rum_log", "rum_pageview", "rum_session", "tenant_usage_daily", "rate_counter",
  "route_registry", "route_cardinality",
];

const args = process.argv.slice(2);
const iJournaux = args.indexOf("--journaux");
const JOURNAUX = iJournaux > -1 ? args[iJournaux + 1] : join(tmpdir(), "mip-capture-agents");
const demandes = args.filter((a, i) => !a.startsWith("--") && (iJournaux < 0 || i !== iJournaux + 1));
const choisis = demandes.length ? demandes : Object.keys(LANGAGES);
for (const l of choisis) {
  if (!(l in LANGAGES)) {
    console.error(`[${SCRIPT}] langage inconnu : ${l} (attendus : ${Object.keys(LANGAGES).join(", ")})`);
    process.exit(2);
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const dire = (m) => console.log(`[${SCRIPT}] ${m}`);

function docker(argsDocker, { sortie = "pipe" } = {}) {
  const r = spawnSync("docker", argsDocker, { cwd: RACINE, encoding: "utf8", stdio: ["ignore", sortie, sortie] });
  if (r.status !== 0) throw new Error(`docker ${argsDocker.join(" ")} : sortie ${r.status}\n${r.stderr ?? ""}`);
  return r.stdout ?? "";
}

const portLibre = () =>
  new Promise((ok, ko) => {
    const s = serveurTcp();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

/** Les variables `export CLÉ="valeur"` du socle de la page Installer, en objet. */
function variablesDuSocle(texte) {
  const env = {};
  for (const ligne of texte.split("\n")) {
    const m = /^export ([A-Z_]+)="([^"]*)"/.exec(ligne);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** `ARG NOM=valeur` d'un Dockerfile : les versions figées de l'agent et de l'application. */
function argumentsDuDockerfile(chemin) {
  const versions = {};
  const images = [];
  for (const ligne of readFileSync(chemin, "utf8").split("\n")) {
    const a = /^ARG\s+([A-Z0-9_]+)=(\S+)/.exec(ligne);
    if (a) versions[a[1]] = a[2];
    const f = /^FROM\s+(\S+)/.exec(ligne);
    if (f) images.push(f[1]);
  }
  return { versions, images };
}

function attributs(liste) {
  return Object.fromEntries((liste ?? []).map((a) => [a.key, a.value ? Object.values(a.value)[0] : undefined]));
}

function decoder(c) {
  const brut = decompresserOtlp(c.octets, c.contentEncoding);
  if (!String(c.contentType).includes("protobuf")) return JSON.parse(brut.toString("utf8"));
  return c.signal === "logs" ? decoderLogsProtobuf(brut) : decoderTracesProtobuf(brut);
}

const pool = new pg.Pool({ connectionString: URL_BASE, max: 2 });
const recus = [];
let serveur;
let relais;

async function nettoyer() {
  for (const l of choisis) {
    for (const table of TABLES_APP) await pool.query(`delete from ${table} where app_id = $1`, [app(l)]);
  }
}

async function demarrer() {
  await nettoyer();
  for (const l of choisis) {
    await pool.query("delete from app_registry where app_id = $1", [app(l)]);
    await pool.query(
      "insert into app_registry (app_id, name, api_key_hash, active, privacy_barrier_mode) values ($1, $1, $2, true, 'off')",
      [app(l), sha256(cle(l))],
    );
  }

  const portCollecte = await portLibre();
  const collecte = `http://127.0.0.1:${portCollecte}`;
  const journal = [];
  serveur = spawn(process.execPath, [join(RACINE, "services", "collector", "dev-server.mjs")], {
    cwd: RACINE,
    // Environnement EXPLICITE : rien n'hérite du shell (pas de DATABASE_URL de production).
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: URL_BASE,
      INGEST_PORT: String(portCollecte),
      PGPOOL_MAX: "3",
      REQUIRE_API_KEY: "true",
      IDENTITY_HASH_SECRET: "r11-secret-identite",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serveur.stdout.on("data", (b) => journal.push(String(b)));
  serveur.stderr.on("data", (b) => journal.push(String(b)));
  const echeance = Date.now() + 20_000;
  for (;;) {
    if (await fetch(`${collecte}/health`).then((r) => r.ok).catch(() => false)) break;
    if (Date.now() > echeance || serveur.exitCode !== null) throw new Error(`dev-server non démarré :\n${journal.join("")}`);
    await pause(150);
  }

  // La session du navigateur, ancrée comme le ferait le SDK web, AVANT les agents :
  // c'est elle que leur `tracestate` revendique.
  const t = (BigInt(Date.now() - 60_000) * 1_000_000n).toString();
  const attr = (key, value) => ({ key, value: { stringValue: value } });
  for (const l of choisis) {
    const r = await fetch(`${collecte}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: [attr("mip.app_id", app(l)), attr("mip.api_key", cle(l))] },
          scopeSpans: [{ spans: [{
            name: "pageview", traceId: trace(l, 1).replace(/0001$/, "0000"), spanId: `e11c00000000000${LANGAGES[l].rang}`,
            startTimeUnixNano: t, endTimeUnixNano: t,
            attributes: [attr("mip.session_id", session(l)), attr("mip.url", "https://factures.exemple.fr/factures/42")],
          }] }],
        }],
      }),
    });
    if (r.status !== 200) throw new Error(`ancre de session ${l} : ${r.status}`);
  }

  // Le relais écoute sur toutes les interfaces : les conteneurs le joignent par
  // host.docker.internal, qui, sous Linux, est la passerelle du pont Docker et non la
  // boucle locale. Il ne transmet qu'au collecteur de développement, et ne vit que le
  // temps de la capture.
  const portRelais = await portLibre();
  relais = createServer((req, res) => {
    const m = /^\/([a-z]+)\/v1\/(traces|logs)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m || !(m[1] in LANGAGES)) {
      res.writeHead(404).end();
      return;
    }
    const morceaux = [];
    req.on("data", (b) => morceaux.push(b));
    req.on("end", async () => {
      const octets = Buffer.concat(morceaux);
      const entete = (n) => (typeof req.headers[n] === "string" ? req.headers[n] : "");
      const c = {
        langage: m[1],
        signal: m[2],
        octets,
        contentType: entete("content-type"),
        contentEncoding: entete("content-encoding"),
        userAgent: entete("user-agent"),
        statut: 0,
        traces: new Set(),
      };
      // Rangé à l'arrivée, pas à la réponse : l'ordre du manifeste est celui de l'envoi.
      recus.push(c);
      try {
        const headers = { "content-type": c.contentType, "user-agent": c.userAgent };
        if (c.contentEncoding) headers["content-encoding"] = c.contentEncoding;
        const r = await fetch(`${collecte}/v1/${c.signal}`, { method: "POST", headers, body: octets });
        const reponse = Buffer.from(await r.arrayBuffer());
        c.statut = r.status;
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/x-protobuf" }).end(reponse);
      } catch (err) {
        c.statut = 502;
        res.writeHead(502).end();
        console.error(`[${SCRIPT}] relais : ${err.message}\n${journal.join("")}`);
      }
      try {
        const lot = decoder(c);
        for (const r of lot.resourceSpans ?? lot.resourceLogs ?? []) {
          for (const s of r.scopeSpans ?? r.scopeLogs ?? []) {
            for (const x of s.spans ?? s.logRecords ?? []) if (x.traceId) c.traces.add(x.traceId);
          }
        }
      } catch (err) {
        console.error(`[${SCRIPT}] corps illisible (${c.langage}, ${c.signal}) : ${err.message}`);
      }
      dire(`${c.langage} ${c.signal} : ${octets.length} octets, ${c.contentEncoding || "sans compression"}, collecte ${c.statut}`);
    });
  });
  await new Promise((ok) => relais.listen(portRelais, "0.0.0.0", ok));
  return { portRelais, journalCollecte: journal };
}

async function capturer(l, portRelais) {
  const nom = `mip-r11-${l}`;
  const dossier = join(ICI, "applications", l);
  dire(`${l} : construction de l'image`);
  docker(["build", "-t", `${nom}:capture`, dossier], { sortie: "inherit" });

  const socle = variablesDuSocle(
    socleOtel({
      appId: app(l),
      service: `factures-${l}`,
      adresses: {
        traces: `http://host.docker.internal:${portRelais}/${l}/v1/traces`,
        logs: `http://host.docker.internal:${portRelais}/${l}/v1/logs`,
      },
    }),
  );
  // Ce que fait le client : la clé remise remplace le repère.
  socle.OTEL_RESOURCE_ATTRIBUTES = socle.OTEL_RESOURCE_ATTRIBUTES.replace(REPERE_CLE_API, cle(l));
  const env = { ...socle, ...LANGAGES[l].env };

  const portApp = await portLibre();
  spawnSync("docker", ["rm", "-f", nom], { stdio: "ignore" });
  docker([
    "run", "-d", "--init", "--name", nom,
    "--add-host", "host.docker.internal:host-gateway",
    "-p", `127.0.0.1:${portApp}:8080`,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    `${nom}:capture`,
  ]);
  const journalApp = () => spawnSync("docker", ["logs", nom], { encoding: "utf8" });
  try {
    const echeance = Date.now() + 180_000;
    for (;;) {
      const j = journalApp();
      if (LANGAGES[l].pret.test(`${j.stdout}${j.stderr}`)) break;
      const etat = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", nom], { encoding: "utf8" }).stdout.trim();
      if (etat !== "true" || Date.now() > echeance) throw new Error(`${l} : l'application n'a pas démarré\n${j.stdout}${j.stderr}`);
      await pause(500);
    }
    await pause(1000);

    for (const a of APPELS) {
      const r = await fetch(`http://127.0.0.1:${portApp}${a.chemin}`, {
        method: a.methode,
        headers: {
          traceparent: `00-${trace(l, a.k)}-${parent(l, a.k)}-01`,
          tracestate: `mip=s:${session(l)}`,
        },
      });
      await r.arrayBuffer();
      dire(`${l} : ${a.methode} ${a.chemin} → ${r.status}`);
    }

    // Les trois traces exportées, puis un délai d'export de plus (5 s par défaut) pour les
    // spans et journaux d'un lot suivant ; alors seulement l'arrêt. Un agent qui ne
    // vide pas ses lots au SIGTERM (Python sous `flask run`) ne perd ainsi rien.
    const attendues = APPELS.map((a) => trace(l, a.k));
    const fin = Date.now() + 90_000;
    while (!attendues.every((t) => recus.some((c) => c.langage === l && c.signal === "traces" && c.traces.has(t)))) {
      if (Date.now() > fin) throw new Error(`${l} : traces non reçues en 90 s`);
      await pause(250);
    }
    await pause(7000);
  } finally {
    spawnSync("docker", ["stop", "-t", "30", nom], { stdio: "ignore" });
    // Les lots vidés à l'arrêt traversent encore le relais.
    await pause(2000);
    const j = journalApp();
    mkdirSync(JOURNAUX, { recursive: true });
    writeFileSync(join(JOURNAUX, `${l}.log`), `${j.stdout}${j.stderr}`);
    spawnSync("docker", ["rm", "-f", nom], { stdio: "ignore" });
  }

  const { versions, images } = argumentsDuDockerfile(join(dossier, "Dockerfile"));
  // Python : ce que pip a réellement résolu, figé dans l'image à sa construction.
  if (l === "python") {
    const gele = docker(["run", "--rm", "--entrypoint", "cat", `${nom}:capture`, "/app/versions.txt"]);
    for (const ligne of gele.split("\n")) {
      const m = /^((?:opentelemetry|flask|werkzeug)[\w.-]*)==(\S+)$/i.exec(ligne.trim());
      if (m) versions[m[1].toLowerCase()] = m[2];
    }
  }
  return { versions, images };
}

function ecrire(details) {
  const manifeste = JSON.parse(readFileSync(MANIFESTE, "utf8"));
  const extension = (enc) => (enc === "gzip" ? ".pb.gz" : enc ? `.pb.${enc}` : ".pb");
  for (const f of readdirSync(ICI)) {
    if (choisis.some((l) => f.startsWith(`${l}-`)) && /\.pb(\.|$)/.test(f)) rmSync(join(ICI, f));
  }
  const corps = manifeste.corps.filter((c) => !choisis.includes(c.langage));
  const date = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  for (const l of choisis) {
    const lots = recus.filter((c) => c.langage === l);
    lots.forEach((c, i) => {
      const fichier = `${l}-${i + 1}-${c.signal}${extension(c.contentEncoding)}`;
      writeFileSync(join(ICI, fichier), c.octets);
      corps.push({
        fichier,
        langage: l,
        signal: c.signal,
        contentType: c.contentType,
        contentEncoding: c.contentEncoding,
        userAgent: c.userAgent,
        octets: c.octets.length,
        sha256: sha256(c.octets),
        statutALaCapture: c.statut,
      });
    });
    const premier = lots.find((c) => c.signal === "traces");
    const ressource = premier ? attributs(decoder(premier).resourceSpans?.[0]?.resource?.attributes) : {};
    manifeste.appels.traces[l] = Object.fromEntries(APPELS.map((a) => [trace(l, a.k), a.attendu]));
    manifeste.langages[l] = {
      capture: `${date}, ${process.env.GITHUB_ACTIONS ? `GitHub Actions (${process.env.GITHUB_WORKFLOW ?? "?"}, run ${process.env.GITHUB_RUN_ID ?? "?"})` : "poste de développement"}, par capturer.mjs`,
      images: details[l].images,
      versions: details[l].versions,
      // Ce que l'agent dit de lui-même, dans la ressource de son premier lot de traces.
      ressource: Object.fromEntries(
        Object.entries(ressource).filter(([k]) => /^telemetry\.|^process\.runtime\.(name|version)$/.test(k)),
      ),
      socle: "le socle de la page Installer (socleOtel, apps/console/lib/recettes-agents-otel.ts), clé factice à la place du repère",
      environnement: LANGAGES[l].env,
      application: LANGAGES[l].application,
      source: LANGAGES[l].source,
    };
  }
  manifeste.corps = corps;
  writeFileSync(MANIFESTE, `${JSON.stringify(manifeste, null, 2)}\n`);
  dire(`manifeste : ${relative(RACINE, MANIFESTE)} (${corps.length} corps)`);
}

let code = 0;
try {
  const { portRelais } = await demarrer();
  const details = {};
  for (const l of choisis) details[l] = await capturer(l, portRelais);
  const refuses = recus.filter((c) => c.statut !== 200);
  if (refuses.length) {
    throw new Error(`corps refusés par la collecte : ${refuses.map((c) => `${c.langage} ${c.signal} ${c.statut}`).join(", ")}`);
  }
  ecrire(details);
} catch (err) {
  console.error(`[${SCRIPT}] ÉCHEC — ${err.stack ?? err.message}`);
  code = 1;
} finally {
  relais?.close();
  if (serveur && serveur.exitCode === null) {
    serveur.kill("SIGTERM");
    await new Promise((r) => serveur.once("exit", r));
  }
  await nettoyer().catch(() => {});
  for (const l of choisis) await pool.query("delete from app_registry where app_id = $1", [app(l)]).catch(() => {});
  await pool.end();
}
process.exit(code);
