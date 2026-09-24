// P5.3 — exceptions backend et OpenTelemetry, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le parseur. Que plusieurs
// exceptions d'un même span deviennent autant de lignes sans se disputer la
// contrainte unique, et qu'un lot rejoué — immédiat ou différé — n'en ajoute
// aucune. Qu'une session revendiquée n'est rattachée que si elle existe DANS LA
// MÊME APP, sans qu'aucune session ne soit créée. Qu'une même exception publiée en
// log et en span avec le même `mip.exception_id` ne fait qu'une ligne, dans les
// deux ordres d'arrivée, et que deux signaux sans identifiant commun restent deux
// lignes. Que le métering ne refacture ni le span porteur ni le log, tout en
// comptant chaque occurrence. Que purge, effacements et DSAR atteignent ces
// lignes, y compris sans session. Enfin, sur une base restée en v69, que le même
// code ne perd aucun lot et active la collecte dès v70 appliquée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildConfig,
  buildHttpServerSpan,
  buildLogPayload,
  buildLogRecord,
  buildPayload,
  type ExceptionInput,
} from "../../packages/agent-node/src/core";
import { buildResourceSpans, msToHr } from "../../packages/rum-sdk/src/otlp-encode";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../packages/backend/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeLogs, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlV69 = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const poolV69 = new pg.Pool(urlV69 ? { connectionString: urlV69, max: 4 } : { max: 4 });

const APP = "p53-backend";
const APP_B = "p53-backend-b";
const APP_METER = "p53-metering";
const APP_LOGS = "p53-logs-seuls";
const APP_DSAR = "p53-dsar";
const APP_V69 = "p53-fenetre-v69";
const APPS = [APP, APP_B, APP_METER, APP_LOGS, APP_DSAR];
const SECRET = "test-only-identity-secret";
const UTILISATEUR = "bob@example.test";
const muet = { error() {} };

/** Tables écrites par ces lots, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "ingest_raw", "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask",
  "rum_breadcrumb", "rum_event", "rum_span", "rum_log", "rum_pageview", "rum_session", "tenant_usage_daily",
];

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;

/** Span OTLP natif propre à ce fichier : `span_id` est unique sur toute la table. */
const spanId = (n: number) => (0x5300000000000000n + BigInt(n)).toString(16);
const traceId = (n: number) => `53${n.toString(16).padStart(30, "0")}`;
const exceptionId = (n: number) => `5300${n.toString(16).padStart(28, "0")}`;
const nanos = (ms: number) => `${Math.round(ms)}000000`;

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= maxVersion)
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    for (const table of TABLES_APP) await db.query(`delete from ${table} where app_id = $1`, [app]);
  }
}

async function enregistrer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    await db.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
}

const kv = (key: string, value: unknown) => ({
  key,
  value: typeof value === "boolean" ? { boolValue: value }
    : typeof value === "number" ? { intValue: String(value) }
      : { stringValue: String(value) },
});
const attributs = (attrs: Attrs) => Object.entries(attrs).map(([key, value]) => kv(key, value));

/** Identités brutes remplacées par leur HMAC, comme aux deux ports d'ingestion. */
const aplatir = (payload: unknown) => flattenOtlp(secureOtlpIdentities(payload, SECRET).payload);
const aplatirLogs = (payload: unknown) => flattenOtlpLogs(secureOtlpIdentities(payload, SECRET).payload);

/** Agent Node réel (core.ts) : resource, scope et span tels qu'ils partent. */
function agent(app: string) {
  return buildConfig({
    MIP_RUM_ENDPOINT: "http://ingest.test/v1/traces",
    MIP_RUM_APP_ID: app,
    MIP_RUM_SERVICE: "checkout-api",
    MIP_RUM_ENV: "staging",
  });
}

function exception(n: number, message: string, over: Partial<ExceptionInput> = {}): ExceptionInput {
  return {
    error: { type: "TypeError", message, stack: `TypeError: ${message}\n    at payer (/srv/app.js:${n}:5)` },
    tsMs: Date.now() - 2_000,
    exceptionId: exceptionId(n),
    handled: false,
    fatal: null,
    ...over,
  };
}

/** Span http.server de l'agent Node portant des exceptions, sans session. */
function requeteNode(app: string, n: number, exceptions: ExceptionInput[]) {
  return buildPayload(agent(app), [buildHttpServerSpan({
    traceId: traceId(n),
    spanId: spanId(n),
    parentSpanId: null,
    method: "POST",
    route: "/api/pay",
    url: null,
    status: 500,
    sessionId: null,
    startMs: Date.now() - 3_000,
    durationMs: 12,
    exceptions,
  })]);
}

/** Log d'exception de l'agent Node, corrélé au span de la requête. */
function logNode(app: string, n: number, exc: ExceptionInput | null, level: "warn" | "error" = "error") {
  return buildLogPayload(agent(app), [buildLogRecord({
    level,
    body: exc ? `TypeError: ${exc.error.message}` : "paiement refusé",
    tsMs: Date.now() - 1_000,
    traceId: traceId(n),
    spanId: spanId(n),
    sessionId: null,
    route: "/api/pay",
    exception: exc,
  })]);
}

/** Émetteur OpenTelemetry Python tiers : événements `exception` sans `mip.exception_id`. */
function spanOtelPython(app: string, n: number, events: Attrs[], spanAttrs: Attrs = {}, traceState?: string) {
  const temps = Date.now() - 4_000;
  return {
    resourceSpans: [{
      resource: { attributes: attributs({ "mip.app_id": app, "service.name": "billing", "telemetry.sdk.language": "python" }) },
      scopeSpans: [{
        scope: { name: "opentelemetry.instrumentation.fastapi" },
        spans: [{
          traceId: traceId(n),
          spanId: spanId(n),
          ...(traceState ? { traceState } : {}),
          kind: 2,
          name: "POST /invoices/{id}",
          startTimeUnixNano: nanos(temps),
          endTimeUnixNano: nanos(temps + 20),
          attributes: attributs({ "http.request.method": "POST", "http.route": "/invoices/{id}", ...spanAttrs }),
          events: events.map((attrs) => ({
            name: "exception",
            // Horodatage natif IDENTIQUE : seule la position distingue ces événements.
            timeUnixNano: nanos(temps + 10),
            attributes: attributs(attrs),
          })),
        }],
      }],
    }],
  };
}

/** Log OpenTelemetry Python tiers portant une exception. */
function logOtelPython(app: string, n: number, attrs: Attrs, severityNumber = 17, avecTemps = true) {
  return {
    resourceLogs: [{
      resource: { attributes: attributs({ "mip.app_id": app, "service.name": "billing", "telemetry.sdk.language": "python" }) },
      scopeLogs: [{
        scope: { name: "opentelemetry.sdk._logs" },
        logRecords: [{
          ...(avecTemps ? { timeUnixNano: nanos(Date.now() - 4_000), observedTimeUnixNano: nanos(Date.now() - 3_990) } : {}),
          severityNumber,
          severityText: severityNumber >= 17 ? "ERROR" : "WARN",
          body: { stringValue: "échec facturation" },
          traceId: traceId(n),
          spanId: spanId(n),
          attributes: attributs(attrs),
        }],
      }],
    }],
  };
}

/** Pageview du SDK web réel : crée la session `session` dans `app`. */
function pageviewWeb(app: string, session: string, n: number) {
  const maintenant = msToHr(Date.now() - 5_000);
  return buildResourceSpans(
    { "service.name": "mip-rum-web", "mip.app_id": app, "mip.release": "3.0.0" },
    [{
      name: "pageview",
      traceId: traceId(n),
      spanId: spanId(n),
      startTime: maintenant,
      endTime: maintenant,
      attributes: {
        "mip.session_id": session, "mip.route": "/factures", "mip.visitor_id": `visiteur-${session}`,
        "mip.url": "https://app.exemple.fr/factures", "mip.nav_type": "navigate", "mip.device_type": "desktop",
      },
    }],
  );
}

async function erreurs(db: pg.Pool, app: string): Promise<Row[]> {
  return (await db.query(
    `select span_id, session_id, trace_id, source_parent_span_id, error_source, origin_signal, exception_id,
            handled, is_fatal, service, env, release, route, kind, message, error_type, stack, occurrences,
            user_id_hash, fingerprint
       from rum_error where app_id = $1 order by trace_id, span_id`,
    [app],
  )).rows;
}

async function compter(db: pg.Pool, table: string, app: string): Promise<number> {
  return Number((await db.query(`select count(*)::int as n from ${table} where app_id = $1`, [app])).rows[0].n);
}

const suite = url ? describe : describe.skip;
const suiteV69 = urlV69 ? describe : describe.skip;

suite("P5.3 — exceptions backend et OpenTelemetry — PostgreSQL", () => {
  beforeAll(async () => {
    // Rejouées DEUX FOIS : v70 doit être inerte au second passage.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await enregistrer(pool, APPS);
    await nettoyer(pool, APPS);
    _resetColonnesCache();
    // Le module console lit DATABASE_URL à son import : la base jetable, jamais une autre.
    process.env.DATABASE_URL = url;
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool, APPS);
    await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
    await pool.end();
    const { pool: consolePool } = await import("../../apps/console/lib/db");
    await consolePool.end();
  });

  it("migration-v70 : deux colonnes, une contrainte NOT VALID qui refuse tout hors contrat", async () => {
    const colonnes = (await pool.query(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'rum_error'
          and column_name in ('origin_signal', 'exception_id') order by column_name`,
    )).rows;
    expect(colonnes).toEqual([
      { column_name: "exception_id", data_type: "text", is_nullable: "YES" },
      { column_name: "origin_signal", data_type: "text", is_nullable: "YES" },
    ]);
    expect((await pool.query(
      "select convalidated from pg_constraint where conrelid = 'public.rum_error'::regclass and conname = 'rum_error_origin_v70'",
    )).rows).toEqual([{ convalidated: false }]);

    await nettoyer(pool, [APP]);
    let n = 900;
    const inserer = (valeurs: Attrs) => pool.query(
      `insert into rum_error (app_id, span_id, ${Object.keys(valeurs).join(", ")})
       values ($1, $2, ${Object.keys(valeurs).map((_, i) => `$${i + 3}`).join(", ")})`,
      [APP, spanId(n++), ...Object.values(valeurs)],
    );
    for (const refus of [
      { origin_signal: "span" },
      { origin_signal: "LOG" },
      { exception_id: exceptionId(1) },
      { origin_signal: "log", exception_id: "alice@example.test" },
      { origin_signal: "log", exception_id: "AB".repeat(16) },
    ]) {
      await expect(inserer(refus), JSON.stringify(refus)).rejects.toMatchObject({ code: "23514", constraint: "rum_error_origin_v70" });
    }
    await inserer({ origin_signal: "span_event", exception_id: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    await inserer({ origin_signal: "log", exception_id: exceptionId(2) });
    await inserer({ origin_signal: "log" });
    expect(await compter(pool, "rum_error", APP)).toBe(3);
  });

  it("plusieurs exceptions dans un span : une ligne chacune, span porteur à part, rejeu inerte", async () => {
    await nettoyer(pool, [APP]);
    const lot = aplatir(requeteNode(APP, 10, [
      exception(11, "total indéfini"),
      exception(12, "total indéfini"),
      exception(13, "carte refusée", { fatal: true }),
    ]));
    expect(await writeRows(pool, lot)).toEqual({ erreurs: { recues: 3, inserees: 3, ignorees: 0 } });
    // Rejeu du même lot : rien n'est réinséré, et le compte le dit.
    expect(await writeRows(pool, lot)).toEqual({ erreurs: { recues: 3, inserees: 0, ignorees: 0 } });

    const rows = await erreurs(pool, APP);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        session_id: null, trace_id: traceId(10), source_parent_span_id: spanId(10), error_source: "node",
        origin_signal: "span_event", handled: false, service: "checkout-api", env: "staging", route: "/api/pay",
        kind: "error", error_type: "TypeError", occurrences: 1,
      });
      expect(row.span_id).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(new Set(rows.map((r) => r.span_id)).size).toBe(3);
    expect(rows.map((r) => r.exception_id).sort()).toEqual([exceptionId(11), exceptionId(12), exceptionId(13)]);
    expect(rows.filter((r) => r.is_fatal === true)).toHaveLength(1);
    // Aucune session créée, le span porteur écrit une seule fois, et la
    // projection n'indexe que lui : une identité dérivée n'est pas un span.
    expect(await compter(pool, "rum_session", APP)).toBe(0);
    expect((await pool.query("select span_id, tier from rum_span where app_id = $1", [APP])).rows)
      .toEqual([{ span_id: spanId(10), tier: "back" }]);
    expect((await pool.query("select kind, source_span_id from rum_event_index where app_id = $1", [APP])).rows)
      .toEqual([{ kind: "span", source_span_id: spanId(10) }]);
  });

  it("sans identifiant, deux exceptions identiques au même instant restent deux occurrences, rejouables", async () => {
    await nettoyer(pool, [APP]);
    const identique = { "exception.type": "ValueError", "exception.message": "montant négatif", "exception.stacktrace": "Traceback" };
    const lot = aplatir(spanOtelPython(APP, 20, [identique, identique]));
    expect((await writeRows(pool, lot)).erreurs).toEqual({ recues: 2, inserees: 2, ignorees: 0 });
    expect((await writeRows(pool, lot)).erreurs).toEqual({ recues: 2, inserees: 0, ignorees: 0 });
    const rows = await erreurs(pool, APP);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.origin_signal, r.exception_id, r.error_source, r.service, r.route])).toEqual([
      ["span_event", null, "python", "billing", "/invoices/:id"],
      ["span_event", null, "python", "billing", "/invoices/:id"],
    ]);
    // La seule branche « serveur OTel » a écrit son span : les exceptions ont été
    // lues avant ses sorties.
    expect(await compter(pool, "rum_span", APP)).toBe(1);
  });

  describe("avec ou sans session", () => {
    it("rattache la session revendiquée seulement si elle existe dans la même app", async () => {
      await nettoyer(pool, [APP, APP_B]);
      const session = "p53-session-a";
      await writeRows(pool, aplatir(pageviewWeb(APP, session, 30)));
      const erreur = { "exception.type": "KeyError", "exception.message": "facture" };

      // Même app, session existante (attribut mip.session_id) : rattachée.
      await writeRows(pool, aplatir(spanOtelPython(APP, 31, [erreur], { "mip.session_id": session })));
      // Session inconnue (tracestate) : NULL, et aucune session créée pour l'occasion.
      await writeRows(pool, aplatir(spanOtelPython(APP, 32, [erreur], {}, "mip=s:p53-session-inconnue")));
      // Session d'une AUTRE app : jamais prêtée.
      await writeRows(pool, aplatir(spanOtelPython(APP_B, 33, [erreur], { "mip.session_id": session })));

      expect((await erreurs(pool, APP)).map((r) => [r.trace_id, r.session_id])).toEqual([
        [traceId(31), session],
        [traceId(32), null],
      ]);
      expect((await erreurs(pool, APP_B)).map((r) => r.session_id)).toEqual([null]);
      expect((await pool.query("select session_id from rum_session where app_id = any($1::text[])", [[APP, APP_B]])).rows)
        .toEqual([{ session_id: session }]);
    });

    it("dans un même lot, la session du navigateur est écrite avant l'exception qui la revendique", async () => {
      await nettoyer(pool, [APP]);
      const session = "p53-session-meme-lot";
      const web = pageviewWeb(APP, session, 40) as { resourceSpans: unknown[] };
      const backend = spanOtelPython(APP, 41, [{ "exception.type": "IOError", "exception.message": "disque" }], {}, `mip=s:${session}`);
      await writeRows(pool, aplatir({ resourceSpans: [...web.resourceSpans, ...backend.resourceSpans] }));
      expect((await erreurs(pool, APP)).map((r) => r.session_id)).toEqual([session]);
    });
  });

  describe("log et span d'une même exception", () => {
    it("même mip.exception_id : une seule ligne, que le log arrive avant ou après le span", async () => {
      await nettoyer(pool, [APP, APP_B]);
      const commune = exception(50, "stock épuisé");

      // Log d'abord, puis span.
      const log = aplatirLogs(logNode(APP, 50, commune));
      expect((await writeLogs(pool, log.logs, log.errors)).erreurs).toEqual({ recues: 1, inserees: 1, ignorees: 0 });
      expect((await writeRows(pool, aplatir(requeteNode(APP, 50, [commune])))).erreurs)
        .toEqual({ recues: 1, inserees: 0, ignorees: 0 });

      // Span d'abord, puis log, dans l'autre app.
      expect((await writeRows(pool, aplatir(requeteNode(APP_B, 51, [commune])))).erreurs)
        .toEqual({ recues: 1, inserees: 1, ignorees: 0 });
      const logB = aplatirLogs(logNode(APP_B, 51, commune));
      expect((await writeLogs(pool, logB.logs, logB.errors)).erreurs).toEqual({ recues: 1, inserees: 0, ignorees: 0 });

      expect((await erreurs(pool, APP)).map((r) => [r.origin_signal, r.exception_id, r.trace_id, r.source_parent_span_id]))
        .toEqual([["log", exceptionId(50), traceId(50), spanId(50)]]);
      expect((await erreurs(pool, APP_B)).map((r) => [r.origin_signal, r.exception_id]))
        .toEqual([["span_event", exceptionId(50)]]);
      // Le log, lui, est bien écrit dans les deux apps : l'exception ne le remplace pas.
      expect(await compter(pool, "rum_log", APP)).toBe(1);
      expect(await compter(pool, "rum_log", APP_B)).toBe(1);
    });

    it("sans identifiant commun, log et span restent deux occurrences : aucune fusion devinée", async () => {
      await nettoyer(pool, [APP]);
      const attrs = { "exception.type": "ValueError", "exception.message": "montant négatif" };
      await writeRows(pool, aplatir(spanOtelPython(APP, 60, [attrs])));
      const log = aplatirLogs(logOtelPython(APP, 60, attrs));
      await writeLogs(pool, log.logs, log.errors);
      const rows = await erreurs(pool, APP);
      expect(rows.map((r) => r.origin_signal).sort()).toEqual(["log", "span_event"]);
      expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(1);
    });

    it("un log texte, un log d'exception sous ERROR ou sans horodatage restent des logs", async () => {
      await nettoyer(pool, [APP]);
      for (const payload of [
        logNode(APP, 70, null),
        logNode(APP, 71, exception(71, "avertissement"), "warn"),
        logOtelPython(APP, 72, { "exception.type": "ValueError", "exception.message": "réessai" }, 13),
        logOtelPython(APP, 73, { "exception.type": "ValueError", "exception.message": "sans temps" }, 17, false),
      ]) {
        const parsed = aplatirLogs(payload);
        await writeLogs(pool, parsed.logs, parsed.errors);
      }
      expect(await compter(pool, "rum_log", APP)).toBe(4);
      expect(await compter(pool, "rum_error", APP)).toBe(0);
    });
  });

  it("métering : ni le span porteur ni le log ne sont refacturés, chaque occurrence compte", async () => {
    await nettoyer(pool, [APP_METER, APP_LOGS]);
    await writeRows(pool, aplatir(requeteNode(APP_METER, 80, [exception(81, "a"), exception(82, "b")])));
    const log = aplatirLogs(logOtelPython(APP_METER, 83, { "exception.type": "E", "exception.message": "c" }));
    await writeLogs(pool, log.logs, log.errors);
    // Une app qui n'envoie que des logs d'exception garde ses occurrences mesurées.
    const seul = aplatirLogs(logOtelPython(APP_LOGS, 84, { "exception.type": "E", "exception.message": "d" }));
    await writeLogs(pool, seul.logs, seul.errors);

    const { rows: [{ jour }] } = await pool.query(
      "select ts::date::text as jour from rum_error where app_id = $1 limit 1", [APP_METER],
    );
    await pool.query("select meter_tenant_usage($1::date)", [jour]);
    const usage = (await pool.query(
      `select app_id, events::int as events, errors::int as errors from tenant_usage_daily
        where app_id = any($1::text[]) and day = $2::date order by app_id`,
      [[APP_METER, APP_LOGS], jour],
    )).rows;
    // APP_METER : un seul événement facturé (le span http.server), trois occurrences.
    expect(usage).toEqual([
      { app_id: APP_LOGS, events: 0, errors: 1 },
      { app_id: APP_METER, events: 1, errors: 3 },
    ]);
  });

  it("chemin différé : la session est vérifiée au drain, et un lot redéposé n'ajoute rien", async () => {
    await nettoyer(pool, [APP]);
    const session = "p53-session-differe";
    await writeRows(pool, aplatir(pageviewWeb(APP, session, 90)));
    const lot = aplatir(spanOtelPython(APP, 91, [{ "exception.type": "OSError", "exception.message": "file" }], {}, `mip=s:${session}`));
    await deposerLot(pool, APP, lot);
    await deposerLot(pool, APP, lot);
    expect(await drainerIngestRaw(pool, { log: muet })).toEqual({ drains: 2, echecs: 0 });
    expect((await erreurs(pool, APP)).map((r) => [r.session_id, r.origin_signal])).toEqual([[session, "span_event"]]);
  });

  describe("rétention, effacements et DSAR", () => {
    const session = "p53-session-dsar";
    const hash = () => hashIdentity(SECRET, APP_DSAR, "user", UTILISATEUR) as string;

    /** Trois lignes dérivées : rattachée à une session, sans session avec identité, sans rien. */
    async function ecrire() {
      await nettoyer(pool, [APP_DSAR]);
      await writeRows(pool, aplatir(pageviewWeb(APP_DSAR, session, 100)));
      const attrs = { "exception.type": "PermissionError", "exception.message": "refus" };
      await writeRows(pool, aplatir(spanOtelPython(APP_DSAR, 101, [attrs], { "mip.session_id": session })));
      await writeRows(pool, aplatir(spanOtelPython(APP_DSAR, 102, [attrs], { "mip.identity.user_id": UTILISATEUR })));
      await writeRows(pool, aplatir(spanOtelPython(APP_DSAR, 103, [attrs])));
      const rows = await erreurs(pool, APP_DSAR);
      expect(rows.map((r) => [r.trace_id, r.session_id, r.user_id_hash])).toEqual([
        [traceId(101), session, null],
        [traceId(102), null, hash()],
        [traceId(103), null, null],
      ]);
      expect(JSON.stringify(rows)).not.toContain(UTILISATEUR);
    }

    it("purge_rum_app, erase_session et erase_app_data les emportent", async () => {
      await ecrire();
      await pool.query("select erase_session($1)", [session]);
      expect((await erreurs(pool, APP_DSAR)).map((r) => r.trace_id)).toEqual([traceId(102), traceId(103)]);

      await pool.query("select purge_rum_app($1, now() + interval '1 minute')", [APP_DSAR]);
      expect(await compter(pool, "rum_error", APP_DSAR)).toBe(0);

      await ecrire();
      await pool.query("select erase_app_data($1)", [APP_DSAR]);
      expect(await compter(pool, "rum_error", APP_DSAR)).toBe(0);
    });

    it("le DSAR par identité compte, exporte et efface l'exception sans session qui porte le HMAC", async () => {
      const { dsarIdentityCounts, dsarIdentityErase, dsarIdentityExport } = await import("../../apps/console/lib/queries-dsar");
      await ecrire();
      expect(await dsarIdentityCounts(APP_DSAR, "user", hash())).toContainEqual({ table: "rum_error", rows: 1 });
      const exporte = await dsarIdentityExport(APP_DSAR, "user", hash(), new Date().toISOString());
      expect(exporte.tables.rum_error).toEqual([expect.objectContaining({
        trace_id: traceId(102), session_id: null, user_id_hash: hash(), origin_signal: "span_event",
      })]);
      expect(await dsarIdentityErase(APP_DSAR, "user", hash())).toContainEqual({ table: "rum_error", deleted: 1 });
      // Ni l'exception d'une session sans cette identité, ni celle sans identité.
      expect((await erreurs(pool, APP_DSAR)).map((r) => r.trace_id)).toEqual([traceId(101), traceId(103)]);
    });
  });
});

suiteV69("fenêtre de déploiement : code P5.3 sur une base restée en v69", () => {
  beforeAll(async () => {
    // Repartir d'un schéma vide : un passage précédent a pu y appliquer v70.
    await poolV69.query("drop schema public cascade; create schema public;");
    for (const file of migrations(69)) await poolV69.query(readFileSync(file, "utf8"));
    await enregistrer(poolV69, [APP_V69]);
    await nettoyer(poolV69, [APP_V69]);
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    await nettoyer(poolV69, [APP_V69]);
    await poolV69.query("delete from app_registry where app_id = $1", [APP_V69]);
    await poolV69.end();
  });

  it("aucun lot perdu avant v70, exceptions dérivées écrites dès v70 appliquée, sans double facturation", async () => {
    const web = pageviewWeb(APP_V69, "p53-session-v69", 110) as { resourceSpans: unknown[] };
    const exceptionWeb = buildResourceSpans(
      { "service.name": "mip-rum-web", "mip.app_id": APP_V69 },
      [{
        name: "exception", traceId: traceId(111), spanId: spanId(111),
        startTime: msToHr(Date.now() - 5_000), endTime: msToHr(Date.now() - 5_000),
        attributes: { "mip.session_id": "p53-session-v69", "exception.type": "TypeError", "exception.message": "navigateur" },
      }],
    ) as { resourceSpans: unknown[] };
    const lotTraces = () => aplatir({
      resourceSpans: [
        ...web.resourceSpans,
        ...exceptionWeb.resourceSpans,
        ...requeteNode(APP_V69, 112, [exception(112, "serveur")]).resourceSpans,
      ],
    });
    const lotLogs = () => aplatirLogs(logNode(APP_V69, 113, exception(113, "journalisée")));

    // v69 : l'erreur navigateur, la session, le span et le log sont écrits ; les
    // exceptions dérivées sont ignorées, sans faire échouer leur lot.
    expect((await writeRows(poolV69, lotTraces())).erreurs).toEqual({ recues: 2, inserees: 1, ignorees: 1 });
    const logs = lotLogs();
    expect((await writeLogs(poolV69, logs.logs, logs.errors)).erreurs).toEqual({ recues: 1, inserees: 0, ignorees: 1 });
    expect(await compter(poolV69, "rum_session", APP_V69)).toBe(1);
    expect(await compter(poolV69, "rum_span", APP_V69)).toBe(1);
    expect(await compter(poolV69, "rum_log", APP_V69)).toBe(1);
    expect((await poolV69.query("select span_id from rum_error where app_id = $1", [APP_V69])).rows)
      .toEqual([{ span_id: spanId(111) }]);

    await poolV69.query(readFileSync(join(SQL_DIR, "migration-v70.sql"), "utf8"));
    _resetColonnesCache();
    expect((await writeRows(poolV69, lotTraces())).erreurs).toEqual({ recues: 2, inserees: 1, ignorees: 0 });
    const logsV70 = lotLogs();
    expect((await writeLogs(poolV69, logsV70.logs, logsV70.errors)).erreurs).toEqual({ recues: 1, inserees: 1, ignorees: 0 });
    expect(new Set((await erreurs(poolV69, APP_V69)).map((r) => r.origin_signal))).toEqual(new Set([null, "span_event", "log"]));

    const { rows: [{ jour }] } = await poolV69.query(
      "select ts::date::text as jour from rum_error where app_id = $1 limit 1", [APP_V69],
    );
    await poolV69.query("select meter_tenant_usage($1::date)", [jour]);
    // Événements : pageview + erreur navigateur + span http.server (écrit deux
    // fois, stocké une fois). Occurrences : navigateur + span + log.
    expect((await poolV69.query(
      "select events::int as events, errors::int as errors from tenant_usage_daily where app_id = $1 and day = $2::date",
      [APP_V69, jour],
    )).rows).toEqual([{ events: 3, errors: 3 }]);
  });
});
