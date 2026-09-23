// Fenêtre de déploiement code P2 / migration v66 : writeRows doit continuer à
// committer les tables v65 réelles en ignorant seulement les champs nouveaux.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../packages/backend/lib/ingest-differe.mjs";

const url = process.env.SQL_TEST_V65_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "p2-v65-compat";
const ACTION = "11111111-2222-4333-8444-555555555555";
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

async function clean() {
  await pool.query("delete from ingest_raw where app_id=$1", [APP]);
  await pool.query("delete from rum_event_index where app_id=$1", [APP]);
  for (const table of ["rum_error", "rum_resource", "rum_breadcrumb", "rum_span"])
    await pool.query(`delete from ${table} where app_id=$1`, [APP]);
  await pool.query("delete from rum_event where app_id=$1", [APP]);
  await pool.query("delete from rum_session where app_id=$1", [APP]);
}

function causalRows(now = new Date()) {
  return {
    sessions: [{
      session_id: "p2-v65-session", app_id: APP, client_id: null, user_hash: null,
      user_agent: "vitest", device_type: "desktop", geo_country: null, is_bot: false,
      collection_source: "sdk", sample_rate: 1, error_sample_rate: 1, has_error: true,
      last_seen_at: now, user_id_hash: "a".repeat(64), context: { plan: "pro" },
    }],
    pageviews: [], metrics: [],
    actions: [{
      action_id: ACTION, span_id: "a100000000006500", session_id: "p2-v65-session",
      app_id: APP, type: "click", name: "Payer", route: "/v65", context: {}, ts: now,
    }],
    errors: [{
      span_id: "a100000000006502", session_id: "p2-v65-session", app_id: APP, route: "/v65",
      kind: "error", message: "boom", error_type: "Error", stack: "", source: null,
      lineno: null, colno: null, release: null, fingerprint: "v65", occurrences: 1,
      action_id: ACTION, ts: now,
    }],
    resources: [{
      span_id: "a100000000006503", session_id: "p2-v65-session", app_id: APP, route: "/v65",
      url: "https://app.test/a.js", type: "script", duration_ms: 20, transfer_size: 10,
      render_blocking: false, action_id: ACTION, ts: now,
    }],
    longtasks: [],
    breadcrumbs: [{
      span_id: "a100000000006504", session_id: "p2-v65-session", app_id: APP, route: "/v65",
      type: "click", label: "Payer", seq: 1, action_id: ACTION, ts: now,
    }],
    events: [{
      span_id: "a100000000006501", session_id: "p2-v65-session", app_id: APP, route: "/v65",
      name: "checkout", props: { kept: true }, ts: now, event_type: "action", action_id: ACTION,
      user_id_hash: "a".repeat(64), context: { plan: "pro" },
    }],
    spans: [{
      span_id: "a100000000006505", trace_id: "a".repeat(32), parent_span_id: null, tier: "front",
      session_id: "p2-v65-session", app_id: APP, route: "/v65", url: "https://app.test/api",
      method: "GET", status_code: 200, duration_ms: 20, name: "GET /api", kind: "client",
      action_id: ACTION, ts: now,
    }],
    eventIndex: [{
      app_id: APP, session_id: "p2-v65-session", ts: now, route: "/v65", kind: "event",
      source_name: "frustration.error", source_span_id: "a100000000006501", action_id: ACTION,
      event_type: "action", user_id_hash: "a".repeat(64), context: { plan: "pro" },
    }],
    sviCalls: [], sviSteps: [], sviLegs: [],
  };
}

beforeAll(async () => {
  if (!url) return;
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  const migrations = readdirSync(SQL_DIR)
    .filter((file) => /^migration-v\d+\.sql$/.test(file) && Number(file.match(/\d+/)?.[0]) <= 65)
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  for (const file of migrations) await pool.query(readFileSync(join(SQL_DIR, file), "utf8"));
  await pool.query(
    "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
    [APP],
  );
  await clean();
  _resetColonnesCache();
}, 180_000);

afterAll(async () => {
  if (!url) return;
  await clean();
  await pool.query("delete from app_registry where app_id=$1", [APP]);
  await pool.end();
});

suite("writeRows sur PostgreSQL v65 réel", () => {
  it("omet les colonnes v66 mais commit session, événement source et index", async () => {
    await writeRows(pool, causalRows());

    expect((await pool.query("select session_id from rum_session where app_id=$1", [APP])).rows).toEqual([
      { session_id: "p2-v65-session" },
    ]);
    expect((await pool.query("select name,props from rum_event where app_id=$1", [APP])).rows).toEqual([
      { name: "checkout", props: { kept: true } },
    ]);
    expect((await pool.query("select kind,source_name,source_span_id from rum_event_index where app_id=$1", [APP])).rows).toEqual([
      { kind: "event", source_name: "track", source_span_id: "a100000000006501" },
    ]);
    expect((await pool.query("select to_regclass('public.rum_action') as relation")).rows[0].relation).toBeNull();
    for (const table of ["rum_error", "rum_resource", "rum_breadcrumb", "rum_span"])
      expect(Number((await pool.query(`select count(*)::int n from ${table} where app_id=$1`, [APP])).rows[0].n)).toBe(1);
    process.env.DATABASE_URL = url;
    const { sessionTimeline } = await import("../../apps/console/lib/queries");
    const timeline = await sessionTimeline("p2-v65-session", APP);
    expect(timeline).toContainEqual(expect.objectContaining({
      kind: "event", title: "checkout", action_id: null, action_name: null,
    }));
    const { pool: consolePool } = await import("../../apps/console/lib/db");
    await consolePool.end();
    const v66Columns = (await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name in ('rum_session','rum_event','rum_event_index')
          and column_name in ('user_id_hash','account_id_hash','context','event_type')`,
    )).rows;
    expect(v66Columns).toEqual([]);
  });

  it("draine le même lot causal sur v65 sans table/colonnes P3", async () => {
    await clean();
    _resetColonnesCache();
    await deposerLot(pool, APP, causalRows());
    await expect(drainerIngestRaw(pool, { log: { error() {} } })).resolves.toEqual({ drains: 1, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_error where app_id=$1", [APP])).rows[0].n)).toBe(1);
    expect((await pool.query("select source_name from rum_event_index where app_id=$1", [APP])).rows)
      .toEqual([{ source_name: "track" }]);
  });

  it("reste compatible après upgrade v66, en immédiat puis différé", async () => {
    await clean();
    await pool.query(readFileSync(join(SQL_DIR, "migration-v66.sql"), "utf8"));
    _resetColonnesCache();
    await writeRows(pool, causalRows());
    expect((await pool.query("select source_name,action_id from rum_event_index where app_id=$1", [APP])).rows)
      .toEqual([{ source_name: "track", action_id: ACTION }]);
    expect((await pool.query("select name,event_type,action_id from rum_event where app_id=$1", [APP])).rows)
      .toEqual([{ name: "checkout", event_type: "action", action_id: ACTION }]);
    expect((await pool.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='rum_error' and column_name='action_id'`,
    )).rows).toEqual([]);
    expect((await pool.query("select to_regclass('public.rum_action') as relation")).rows[0].relation).toBeNull();

    await clean();
    _resetColonnesCache();
    await deposerLot(pool, APP, causalRows());
    await expect(drainerIngestRaw(pool, { log: { error() {} } })).resolves.toEqual({ drains: 1, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_error where app_id=$1", [APP])).rows[0].n)).toBe(1);
    expect((await pool.query("select source_name from rum_event_index where app_id=$1", [APP])).rows)
      .toEqual([{ source_name: "track" }]);
  });
});
