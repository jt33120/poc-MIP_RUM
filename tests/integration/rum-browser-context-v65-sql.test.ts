// Fenêtre de déploiement code P2 / migration v66 : writeRows doit continuer à
// committer les tables v65 réelles en ignorant seulement les champs nouveaux.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";

const url = process.env.SQL_TEST_V65_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "p2-v65-compat";
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

async function clean() {
  await pool.query("delete from rum_event_index where app_id=$1", [APP]);
  await pool.query("delete from rum_event where app_id=$1", [APP]);
  await pool.query("delete from rum_session where app_id=$1", [APP]);
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
    const now = new Date();
    await writeRows(pool, {
      sessions: [{
        session_id: "p2-v65-session", app_id: APP, client_id: null, user_hash: null,
        user_agent: "vitest", device_type: "desktop", geo_country: null, is_bot: false,
        collection_source: "sdk", sample_rate: 1, error_sample_rate: 1, has_error: false,
        last_seen_at: now, user_id_hash: "a".repeat(64), context: { plan: "pro" },
      }],
      pageviews: [], metrics: [], errors: [], resources: [], longtasks: [], breadcrumbs: [],
      events: [{
        span_id: "a100000000006501", session_id: "p2-v65-session", app_id: APP, route: "/v65",
        name: "checkout", props: { kept: true }, ts: now, event_type: "action",
        user_id_hash: "a".repeat(64), context: { plan: "pro" },
      }],
      spans: [],
      eventIndex: [{
        app_id: APP, session_id: "p2-v65-session", ts: now, route: "/v65", kind: "event",
        source_name: "track", source_span_id: "a100000000006501", event_type: "action",
        user_id_hash: "a".repeat(64), context: { plan: "pro" },
      }],
      sviCalls: [], sviSteps: [], sviLegs: [],
    });

    expect((await pool.query("select session_id from rum_session where app_id=$1", [APP])).rows).toEqual([
      { session_id: "p2-v65-session" },
    ]);
    expect((await pool.query("select name,props from rum_event where app_id=$1", [APP])).rows).toEqual([
      { name: "checkout", props: { kept: true } },
    ]);
    expect((await pool.query("select kind,source_span_id from rum_event_index where app_id=$1", [APP])).rows).toEqual([
      { kind: "event", source_span_id: "a100000000006501" },
    ]);
    const v66Columns = (await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name in ('rum_session','rum_event','rum_event_index')
          and column_name in ('user_id_hash','account_id_hash','context','event_type')`,
    )).rows;
    expect(v66Columns).toEqual([]);
  });
});
