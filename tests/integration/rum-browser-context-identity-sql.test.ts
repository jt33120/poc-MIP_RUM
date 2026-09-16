import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../apps/ingest/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { deposerLot, drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS sans déclarations
import { writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";
import {
  dsarIdentityCounts,
  dsarIdentityErase,
  dsarIdentityExport,
  type IdentityDsarIo,
} from "../../apps/console/lib/queries-dsar";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "p2-context-app";
const OTHER_APP = "p2-context-other";
const RAW = "alice@example.test";
const SECRET = "test-only-identity-secret";
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

function attributes(values: Record<string, string | number>) {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
  }));
}

function lot(spanId: string, raw = RAW, sessionId = `session-${spanId}`) {
  const nowNanos = BigInt(Date.now()) * 1_000_000n;
  const actionId = spanId.repeat(2);
  const payload = {
    resourceSpans: [{
      resource: { attributes: attributes({ "mip.app_id": APP }) },
      scopeSpans: [{ spans: [{
        name: "rum.action",
        traceId: "a".repeat(32),
        spanId,
        startTimeUnixNano: nowNanos.toString(),
        endTimeUnixNano: (nowNanos + 10_000_000n).toString(),
        attributes: attributes({
          "mip.session_id": sessionId,
          "mip.route": "/checkout",
          "mip.event_type": "action",
          "mip.event_name": "checkout",
          "mip.identity.user_id": raw,
          "mip.view_id": "view-checkout",
          "mip.action_id": actionId,
          "mip.context": JSON.stringify({ plan: "pro", email: raw }),
        }),
      }] }],
    }],
  };
  return flattenOtlp(secureOtlpIdentities(payload, SECRET).payload);
}

async function clean() {
  for (const app of [APP, OTHER_APP]) {
    await pool.query("delete from ingest_raw where app_id=$1", [app]);
    await pool.query("delete from rum_event_index where app_id=$1", [app]);
    await pool.query("delete from rum_action where app_id=$1", [app]);
    await pool.query("delete from rum_event where app_id=$1", [app]);
    await pool.query("delete from rum_pageview where app_id=$1", [app]);
    await pool.query("delete from rum_session where app_id=$1", [app]);
  }
}

const dsarIo: IdentityDsarIo = {
  query: async <T,>(text: string, params?: unknown[]) =>
    (await pool.query(text, params)).rows as T[],
  transaction: async <T,>(fn: (client: pg.PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
};

beforeAll(async () => {
  if (!url) return;
  const files = readdirSync(SQL_DIR)
    .filter((file) => /^migration-v\d+\.sql$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const file of files) await pool.query(readFileSync(join(SQL_DIR, file), "utf8"));
  for (const app of [APP, OTHER_APP]) {
    await pool.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
  await clean();
}, 180_000);

afterAll(async () => {
  if (!url) return;
  await clean();
  await pool.query("delete from app_registry where app_id=any($1::text[])", [[APP, OTHER_APP]]);
  await pool.end();
});

suite("P2 contexte et identité — PostgreSQL", () => {
  it("dual-write le snapshot scrubbed et le HMAC en immédiat", async () => {
    await writeRows(pool, lot("a100000000000001"));
    const session = (await pool.query(
      "select user_id_hash, context from rum_session where app_id=$1", [APP],
    )).rows[0];
    const event = (await pool.query(
      "select event_type, user_id_hash, context, view_id, action_id from rum_event where app_id=$1", [APP],
    )).rows[0];
    const index = (await pool.query(
      "select event_type, user_id_hash, context from rum_event_index where app_id=$1", [APP],
    )).rows[0];
    expect(session.user_id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(event).toMatchObject({ event_type: "action", view_id: "view-checkout", action_id: "a100000000000001a100000000000001" });
    expect(index.event_type).toBe("action");
    expect(event.context).toEqual({ plan: "pro", email: "[email]" });
    expect(JSON.stringify({ session, event, index })).not.toContain(RAW);
  });

  it("le chemin différé ne met jamais le brut en file et conserve la projection", async () => {
    await clean();
    const rows = lot("a100000000000002");
    await deposerLot(pool, APP, rows);
    const queued = (await pool.query("select lot::text as lot from ingest_raw where app_id=$1", [APP])).rows[0].lot;
    expect(queued).not.toContain(RAW);
    expect(await drainerIngestRaw(pool, { log: { error() {} } })).toEqual({ drains: 1, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(1);
  });

  it("la projection ne rejoint pas le métering", async () => {
    const definition = (await pool.query<{ sql: string }>(
      "select pg_get_functiondef('meter_tenant_usage(date)'::regprocedure) as sql",
    )).rows[0].sql;
    expect(definition).not.toContain("rum_event_index");
  });

  it("isole deux identités successives dans deux sessions et deux exports DSAR", async () => {
    await clean();
    const bob = "bob@example.test";
    await writeRows(pool, lot("a100000000000031", RAW, "identity-session-a"));
    await writeRows(pool, lot("a100000000000032", bob, "identity-session-b"));
    const aliceExport = await dsarIdentityExport(
      APP, "user", hashIdentity(SECRET, APP, "user", RAW)!, "2026-09-15T00:00:00.000Z", dsarIo,
    );
    const bobExport = await dsarIdentityExport(
      APP, "user", hashIdentity(SECRET, APP, "user", bob)!, "2026-09-15T00:00:00.000Z", dsarIo,
    );
    expect(aliceExport.tables.rum_session.map((row: { session_id: string }) => row.session_id)).toEqual(["identity-session-a"]);
    expect(bobExport.tables.rum_session.map((row: { session_id: string }) => row.session_id)).toEqual(["identity-session-b"]);
    expect(JSON.stringify(aliceExport)).not.toContain("identity-session-b");
    expect(JSON.stringify(bobExport)).not.toContain("identity-session-a");
  });

  it("exécute counts/export/erase par HMAC, scopés à l'app, jusque dans sources, index et file", async () => {
    await clean();
    await writeRows(pool, lot("a100000000000003"));
    const hash = hashIdentity(SECRET, APP, "user", RAW)!;
    const sessionId = "session-a100000000000003";

    await pool.query(
      `insert into rum_pageview (span_id,session_id,app_id,route,started_at)
       values ('a100000000000013',$1,$2,'/checkout',now())`,
      [sessionId, APP],
    );
    // Même hash injecté dans un autre tenant : une requête qui oublierait
    // app_id le verrait et le supprimerait, donc cette sentinelle prouve le scope.
    await pool.query(
      `insert into rum_session (session_id,app_id,user_id_hash)
       values ('p2-other-session',$1,$2)`,
      [OTHER_APP, hash],
    );
    await pool.query(
      `insert into rum_event (span_id,session_id,app_id,route,name,props,ts,user_id_hash)
       values ('a100000000000023','p2-other-session',$1,'/other','sentinel','{}',now(),$2)`,
      [OTHER_APP, hash],
    );
    await pool.query(
      `insert into rum_event_index (app_id,session_id,ts,route,kind,source_name,source_span_id,user_id_hash)
       values ($1,'p2-other-session',now(),'/other','event','track','a100000000000023',$2)`,
      [OTHER_APP, hash],
    );
    for (const [app, sid] of [[APP, sessionId], [OTHER_APP, "p2-other-session"]]) {
      await pool.query(
        `insert into ingest_raw (app_id,lot) values ($1,$2::jsonb)`,
        [app, JSON.stringify({ sessions: [{ session_id: sid, app_id: app }] })],
      );
    }

    const counts = await dsarIdentityCounts(APP, "user", hash, dsarIo);
    expect(counts).toContainEqual({ table: "rum_event", rows: 1 });
    expect(counts).toContainEqual({ table: "rum_event_index", rows: 1 });
    expect(counts).toContainEqual({ table: "rum_action", rows: 1 });
    expect(counts).toContainEqual({ table: "rum_pageview", rows: 1 });
    expect(counts).toContainEqual({ table: "rum_session", rows: 1 });

    const exported = await dsarIdentityExport(APP, "user", hash, "2026-09-15T00:00:00.000Z", dsarIo);
    expect(exported.tables.rum_session).toHaveLength(1);
    expect(exported.tables.rum_event).toHaveLength(1);
    expect(exported.tables.rum_action).toHaveLength(1);
    expect(JSON.stringify(exported.tables)).not.toContain(OTHER_APP);

    const deleted = await dsarIdentityErase(APP, "user", hash, dsarIo);
    expect(deleted).toContainEqual({ table: "rum_event", deleted: 1 });
    expect(deleted).toContainEqual({ table: "rum_event_index", deleted: 1 });
    expect(deleted).toContainEqual({ table: "rum_action", deleted: 1 });
    expect(deleted).toContainEqual({ table: "rum_pageview", deleted: 1 });
    expect(deleted).toContainEqual({ table: "rum_session", deleted: 1 });
    expect(Number((await pool.query("select count(*)::int n from ingest_raw where app_id=$1", [APP])).rows[0].n)).toBe(0);
    expect(Number((await pool.query("select count(*)::int n from rum_session where app_id=$1", [OTHER_APP])).rows[0].n)).toBe(1);
    expect(Number((await pool.query("select count(*)::int n from rum_event_index where app_id=$1", [OTHER_APP])).rows[0].n)).toBe(1);
    expect(Number((await pool.query("select count(*)::int n from ingest_raw where app_id=$1", [OTHER_APP])).rows[0].n)).toBe(1);
  });
});
