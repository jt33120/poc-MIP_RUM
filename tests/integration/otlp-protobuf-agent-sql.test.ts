// R11 — un VRAI SDK OpenTelemetry (Node), exportateurs OTLP/HTTP protobuf
// officiels, configurés par les variables d'environnement STANDARD, vers le
// serveur de développement du collector (`services/collector/dev-server.mjs`,
// processus à part), et les lignes attendues dans un vrai PostgreSQL.
//
// Ce que ce fichier prouve, et que les tests unitaires ne peuvent pas prouver :
//   · la configuration documentée dans la fiche des capteurs serveur (§ 1, « Le socle
//     commun ») marche telle quelle : endpoint par signal,
//     compression gzip, `mip.app_id` et `mip.api_key` en attributs de ressource ;
//   · l'exportateur officiel lit notre réponse (corps protobuf vide) comme un
//     SUCCÈS — et un refus de clé comme un échec définitif, sans rejeu ;
//   · le span serveur, l'appel SQL, l'exception et les deux logs arrivent en base,
//     rattachés à la session du navigateur par le `tracestate` W3C.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emettreLogs, emettreTraces } from "../fixtures/otlp-officiel";

const URL_TEST = process.env.SQL_TEST_DATABASE_URL;
const RACINE = join(__dirname, "..", "..");
const SQL_DIR = join(RACINE, "packages", "db", "sql");
const APP = { id: "r11-agent", cle: "r11-agent-cle" };
const SESSION = "r11-agent-session";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Tables écrites par ces lots, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask", "rum_breadcrumb",
  "rum_event", "rum_span", "rum_log", "rum_pageview", "rum_session", "tenant_usage_daily", "rate_counter",
];

const pool = new pg.Pool(URL_TEST ? { connectionString: URL_TEST, max: 3 } : { max: 3 });
const suite = URL_TEST ? describe : describe.skip;
if (!URL_TEST) console.warn("[otlp-protobuf-agent-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return ["schema.sql", ...migrations].map((f) => join(SQL_DIR, f));
}

const portLibre = () =>
  new Promise<number>((ok, ko) => {
    const s = createServer();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

/** Retient le résultat de chaque export, tel que l'exportateur officiel le rend. */
function espionner<T extends { export: (items: never, cb: (r: ExportResult) => void) => void }>(exportateur: T) {
  const resultats: ExportResult[] = [];
  const origine = exportateur.export.bind(exportateur) as (items: unknown, cb: (r: ExportResult) => void) => void;
  (exportateur as { export: unknown }).export = (items: unknown, cb: (r: ExportResult) => void) =>
    origine(items, (r) => {
      resultats.push(r);
      cb(r);
    });
  return resultats;
}

/**
 * Les exportateurs, configurés COMME DANS LA DOC : variables d'environnement
 * standard, lues à la construction. Rien dans le code.
 */
function exportateurs(base: string) {
  const avant = { ...process.env };
  Object.assign(process.env, {
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${base}/v1/traces`,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${base}/v1/logs`,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
  });
  try {
    return { traces: new OTLPTraceExporter(), logs: new OTLPLogExporter() };
  } finally {
    for (const cle of Object.keys(process.env)) if (!(cle in avant)) delete process.env[cle];
  }
}

suite("R11 — agent OpenTelemetry officiel (protobuf) → dev-server du collector → Postgres", () => {
  let serveur: ChildProcess | undefined;
  let base = "";
  const journal: string[] = [];

  async function nettoyer() {
    for (const table of TABLES_APP) await pool.query(`delete from ${table} where app_id = $1`, [APP.id]);
  }

  beforeAll(async () => {
    const c = await pool.connect();
    try {
      for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    } finally {
      c.release();
    }
    await nettoyer();
    await pool.query("delete from app_registry where app_id = $1", [APP.id]);
    await pool.query(
      "insert into app_registry (app_id, name, api_key_hash, active, privacy_barrier_mode) values ($1, $1, $2, true, 'off')",
      [APP.id, sha256(APP.cle)],
    );

    const port = await portLibre();
    base = `http://127.0.0.1:${port}`;
    serveur = spawn(process.execPath, [join(RACINE, "services", "collector", "dev-server.mjs")], {
      cwd: RACINE,
      // Environnement EXPLICITE : rien n'hérite du shell (pas de DATABASE_URL de production).
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: URL_TEST!,
        INGEST_PORT: String(port),
        PGPOOL_MAX: "3",
        REQUIRE_API_KEY: "true",
        IDENTITY_HASH_SECRET: "r11-secret-identite",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serveur.stdout!.on("data", (b) => journal.push(String(b)));
    serveur.stderr!.on("data", (b) => journal.push(String(b)));
    const echeance = Date.now() + 20_000;
    for (;;) {
      const ok = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      if (Date.now() > echeance || serveur.exitCode !== null) throw new Error(`dev-server non démarré :\n${journal.join("")}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    // La session du navigateur, ancrée comme le ferait le SDK web (JSON) : le
    // span serveur s'y rattache par son `tracestate`.
    const t = (BigInt(Date.now() - 60_000) * 1_000_000n).toString();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const ancre = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: [attr("mip.app_id", APP.id), attr("mip.api_key", APP.cle)] },
          scopeSpans: [{ spans: [{
            name: "pageview", traceId: "e11c0000000000000000000000000001", spanId: "e11c000000000001",
            startTimeUnixNano: t, endTimeUnixNano: t,
            attributes: [attr("mip.session_id", SESSION), attr("mip.url", "https://factures.exemple.fr/factures/42")],
          }] }],
        }],
      }),
    });
    expect(ancre.status).toBe(200);
  }, 180_000);

  afterAll(async () => {
    if (serveur && serveur.exitCode === null) {
      serveur.kill("SIGTERM");
      await new Promise((r) => serveur!.once("exit", r));
    }
    await nettoyer();
    await pool.query("delete from app_registry where app_id = $1", [APP.id]);
    await pool.end();
  });

  it("traces et logs exportés par le SDK officiel : succès côté exportateur, lignes en base", async () => {
    const { traces, logs } = exportateurs(base);
    const resultatsTraces = espionner(traces);
    const resultatsLogs = espionner(logs);
    const agent = { appId: APP.id, cle: APP.cle, session: SESSION, t0: Date.now() - 30_000, traceId: "e11c0000000000000000000000000002" };

    const fournisseurTraces = emettreTraces(agent, new SimpleSpanProcessor(traces));
    const fournisseurLogs = emettreLogs(agent, new SimpleLogRecordProcessor({ exporter: logs }));
    await fournisseurTraces.forceFlush();
    await fournisseurLogs.forceFlush();

    // Notre réponse (protobuf, corps vide) est un SUCCÈS pour l'exportateur officiel.
    expect(resultatsTraces.map((r) => r.code), journal.join("")).toEqual([ExportResultCode.SUCCESS, ExportResultCode.SUCCESS]);
    expect(resultatsLogs.map((r) => r.code), journal.join("")).toEqual([ExportResultCode.SUCCESS, ExportResultCode.SUCCESS]);

    const spans = await pool.query(
      "select tier, session_id, method, status_code, route from rum_span where app_id = $1 and trace_id = $2 order by tier",
      [APP.id, agent.traceId],
    );
    expect(spans.rows).toEqual([
      // `http.route` normalisé par l'ingestion (`{id}` → `:id`), comme en JSON.
      { tier: "back", session_id: SESSION, method: "GET", status_code: 500, route: "/factures/:id" },
      // L'appel SQL hérite de la session de sa trace.
      expect.objectContaining({ tier: "detail", session_id: SESSION }),
    ]);
    const erreurs = await pool.query("select count(*)::int n from rum_error where app_id = $1 and trace_id = $2", [APP.id, agent.traceId]);
    // L'exception du span (événement) et celle du log ERROR : deux signaux, sans identifiant commun.
    expect(erreurs.rows[0].n).toBe(2);
    const lignesLogs = await pool.query(
      "select severity_num, session_id from rum_log where app_id = $1 and trace_id = $2 order by severity_num",
      [APP.id, agent.traceId],
    );
    expect(lignesLogs.rows).toEqual([
      { severity_num: 9, session_id: SESSION },
      { severity_num: 17, session_id: SESSION },
    ]);
  }, 30_000);

  it("clé d'API fausse : 403, échec DÉFINITIF pour l'exportateur, rien d'écrit", async () => {
    const { traces } = exportateurs(base);
    const resultats = espionner(traces);
    const agent = { appId: APP.id, cle: "mauvaise-cle", session: SESSION, t0: Date.now() - 20_000, traceId: "e11c0000000000000000000000000003" };
    // Le processeur remonte l'échec d'export par `forceFlush` : attendu ici.
    await emettreTraces(agent, new SimpleSpanProcessor(traces)).forceFlush().catch(() => {});
    expect(resultats.length).toBeGreaterThan(0);
    for (const r of resultats) expect(r.code).toBe(ExportResultCode.FAILED);
    const { rows } = await pool.query("select count(*)::int n from rum_span where trace_id = $1", [agent.traceId]);
    expect(rows[0].n).toBe(0);
    expect(journal.join("")).toContain("rejected: api key");
  }, 30_000);
});
