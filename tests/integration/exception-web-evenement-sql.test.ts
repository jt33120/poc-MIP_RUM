// Une exception du SDK web = UNE ligne rum_error, sur un vrai PostgreSQL.
//
// Depuis le 01/10/2026, le SDK web porte chaque erreur deux fois sur le fil : en
// attributs du span « exception » (ce que l'ingestion MIP lit depuis toujours) et
// dans un événement OpenTelemetry « exception » (ce qu'un backend tiers lit).
// L'ingestion sait dériver une erreur d'un événement de span (P5.3) : sans la
// règle « le span `exception` EST l'exception » (packages/backend/shared/otlp.mjs,
// `porteursDuLot` et `spanEventExceptions`), chaque erreur navigateur compterait
// double — au taux d'erreur, aux issues, au métering.
//
// Le lot est produit par le VRAI émetteur du SDK (packages/rum-sdk/src/otel.ts),
// avec un faux DOM et un `fetch` intercepté, puis écrit par l'écrivain des deux
// ports d'ingestion (`writeRows`).
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm vitest run tests/integration/exception-web-evenement-sql.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const suite = url ? describe : describe.skip;

const APP = "sdk-web-exception-evenement";
const SECRET = "test-only-identity-secret";
/** Tables écrites par ces lots, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask",
  "rum_breadcrumb", "rum_event", "rum_span", "rum_pageview", "rum_session", "tenant_usage_daily",
];

function migrations(): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer() {
  for (const table of TABLES_APP) await pool.query(`delete from ${table} where app_id = $1`, [APP]);
}

type Envoi = { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; events?: unknown[] }> }> }> };

/**
 * Le lot que POSTe le SDK web pour une page vue suivie de `erreurs` exceptions :
 * l'émetteur réel, son encodeur, sa dérivation de l'événement.
 */
async function lotDuSdk(session: string, erreurs: Array<{ type: string; message: string }>): Promise<Envoi> {
  const envois: Envoi[] = [];
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36" });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {} });
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    envois.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => null } };
  });
  try {
    vi.resetModules();
    const otel = await import("../../packages/rum-sdk/src/otel");
    const tracer = otel.initOtel({ endpoint: "https://ingest.test/v1/traces", appId: APP, flushIntervalMs: 3_600_000 });
    otel.newPageTrace();
    const debut = Date.now() - 5_000;
    const pv = tracer.startSpan("pageview", { startTime: debut });
    pv.setAttributes({ "mip.session_id": session, "mip.route": "/payer", "mip.url": "https://app.test/payer", "mip.device_type": "desktop" });
    pv.end(debut);
    erreurs.forEach((e, i) => {
      const exc = tracer.startSpan("exception", { startTime: debut + 100 + i });
      exc.setAttributes({
        "mip.session_id": session,
        "mip.route": "/payer",
        "mip.error_kind": "error",
        "exception.type": e.type,
        "exception.message": e.message,
        "exception.stacktrace": `${e.type}: ${e.message}\n    at payer (https://app.test/app.js:3:7)`,
      });
      exc.end(debut + 100 + i);
    });
    await otel.forceFlush();
  } finally {
    vi.unstubAllGlobals();
  }
  expect(envois).toHaveLength(1);
  return envois[0];
}

const aplatir = (payload: unknown) => flattenOtlp(secureOtlpIdentities(payload, SECRET).payload);

const erreursEnBase = async () =>
  (await pool.query(
    "select session_id, error_type, message, origin_signal from rum_error where app_id = $1 order by error_type",
    [APP],
  )).rows;

suite("SDK web — une exception portée en span ET en événement ne compte qu'une fois — PostgreSQL", () => {
  beforeAll(async () => {
    for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    await pool.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [APP],
    );
    await nettoyer();
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    await nettoyer();
    await pool.query("delete from app_registry where app_id = $1", [APP]);
    await pool.end();
  });

  it("le lot du SDK porte bien l'événement, et l'écriture ne donne qu'une ligne rum_error", async () => {
    const lot = await lotDuSdk("sess-evenement-1", [{ type: "TypeError", message: "montant invalide" }]);
    const exc = lot.resourceSpans[0].scopeSpans[0].spans.find((s) => s.name === "exception")!;
    expect(exc.events).toHaveLength(1);

    const rows = aplatir(lot);
    expect(rows.errors).toHaveLength(1);
    expect(rows.rejected).toBe(0);
    expect((await writeRows(pool, rows)).erreurs).toEqual({ recues: 1, inserees: 1, ignorees: 0 });

    const enBase = await erreursEnBase();
    expect(enBase).toHaveLength(1);
    // Une erreur de SESSION navigateur, pas une exception dérivée d'événement.
    expect(enBase[0]).toMatchObject({ session_id: "sess-evenement-1", error_type: "TypeError", message: "montant invalide" });
    expect(enBase[0].origin_signal).not.toBe("span_event");
  });

  it("trois erreurs distinctes : trois lignes, ni six ni une", async () => {
    await nettoyer();
    const lot = await lotDuSdk("sess-evenement-2", [
      { type: "TypeError", message: "a" },
      { type: "RangeError", message: "b" },
      { type: "SyntaxError", message: "c" },
    ]);
    await writeRows(pool, aplatir(lot));
    const enBase = await erreursEnBase();
    expect(enBase.map((r) => r.error_type)).toEqual(["RangeError", "SyntaxError", "TypeError"]);
    // Le lot rejoué (file de rejeu du SDK, relais) n'en ajoute aucune.
    await writeRows(pool, aplatir(JSON.parse(JSON.stringify(lot))));
    expect(await erreursEnBase()).toHaveLength(3);
  });
});
