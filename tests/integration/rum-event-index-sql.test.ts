// P1 — la projection unifiée doit être vraie sur PostgreSQL : conflits,
// métering, purge/DSAR et RLS ne se prouvent pas par une simple lecture SQL.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans déclaration de types
import { writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error — module .mjs sans déclaration de types
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const dir = join(__dirname, "..", "..", "apps", "ingest", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const suite = url ? describe : describe.skip;
const APP = "p1-index-a";
const OTHER_APP = "p1-index-b";

function migrations() {
  return ["schema.sql", ...readdirSync(dir)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(dir, f));
}

function lot(app = APP, session = "p1-index-session") {
  const stringValue = (value: string) => ({ stringValue: value });
  const attrs = (values: Record<string, string | number>) => Object.entries(values).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : stringValue(value),
  }));
  const now = BigInt(Date.now()) * 1_000_000n;
  let sequence = app === APP ? 0x100 : 0x200;
  const span = (name: string, extra: Record<string, string | number> = {}) => {
    const id = (sequence++).toString(16).padStart(16, "0");
    return {
      name,
      spanId: id,
      traceId: id.padStart(32, "0"),
      startTimeUnixNano: now.toString(),
      endTimeUnixNano: (now + 1_000_000n).toString(),
      attributes: attrs({ "mip.session_id": session, "mip.route": "/checkout?email=jane@example.test", ...extra }),
    };
  };
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: attrs({ "mip.app_id": app }) },
      scopeSpans: [{ spans: [
        span("pageview", { "mip.url": "https://app.example/checkout?email=jane@example.test" }),
        span("webvital.LCP", { "webvital.name": "LCP", "webvital.value": 1200 }),
        span("exception", { "exception.message": "failed jane@example.test", "exception.type": "Error" }),
        span("resource", { "resource.type": "script" }),
        span("longtask", { "longtask.duration_ms": 200 }),
        span("breadcrumb", { "breadcrumb.type": "click", "breadcrumb.label": "Payer" }),
        span("track.checkout", { "mip.props": '{"email":"jane@example.test","token":"sk-live-secret"}' }),
        span("http.client", { "mip.trace_id": "000000000000000000000000000002ff", "mip.span_id": "00000000000002ff", "http.duration_ms": 42 }),
      ] }],
    }],
  });
}

function oversizedEventLot() {
  const stringValue = (value: string) => ({ stringValue: value });
  const props = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [
    i === 0 ? "token" : `key_${i}`,
    i === 0 ? "sk-live-secret" : "x".repeat(700),
  ]));
  const now = (BigInt(Date.now()) * 1_000_000n).toString();
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: [{ key: "mip.app_id", value: stringValue(APP) }] },
      scopeSpans: [{ spans: [{
        name: "track.oversized",
        spanId: "00000000000068ee",
        traceId: "000000000000000000000000000068ee",
        startTimeUnixNano: now,
        endTimeUnixNano: now,
        attributes: [
          { key: "mip.session_id", value: stringValue("p4-oversized-session") },
          { key: "mip.route", value: stringValue("/oversized") },
          { key: "mip.props", value: stringValue(JSON.stringify(props)) },
        ],
      }] }],
    }],
  });
}

function vitalsConsolides() {
  const stringValue = (value: string) => ({ stringValue: value });
  const attrs = (values: Record<string, string | number>) => Object.entries(values).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : stringValue(value),
  }));
  const now = BigInt(Date.now()) * 1_000_000n;
  const span = (name: string, spanId: string, extra: Record<string, string | number>) => ({
    name,
    spanId,
    traceId: "000000000000000000000000000001aa",
    startTimeUnixNano: now.toString(),
    endTimeUnixNano: (now + 1_000_000n).toString(),
    attributes: attrs({ "mip.session_id": "p1-vital-session", "mip.route": "/checkout", ...extra }),
  });
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: attrs({ "mip.app_id": APP }) },
      scopeSpans: [{ spans: [
        span("pageview", "00000000000001a1", { "mip.url": "https://app.example/checkout" }),
        span("webvital.CLS", "00000000000001a2", { "webvital.name": "CLS", "webvital.value": 0.1, "webvital.id": "stable-cls" }),
        span("webvital.CLS", "00000000000001a3", { "webvital.name": "CLS", "webvital.value": 0.2, "webvital.id": "stable-cls" }),
      ] }],
    }],
  });
}

async function clean(app: string) {
  await pool.query("delete from tenant_usage_daily where app_id = $1", [app]);
  await pool.query("delete from rum_event_index where app_id = $1", [app]);
  await pool.query("delete from rum_metric where app_id = $1", [app]);
  await pool.query("delete from rum_error where app_id = $1", [app]);
  await pool.query("delete from rum_resource where app_id = $1", [app]);
  await pool.query("delete from rum_longtask where app_id = $1", [app]);
  await pool.query("delete from rum_breadcrumb where app_id = $1", [app]);
  await pool.query("delete from rum_event where app_id = $1", [app]);
  await pool.query("delete from rum_span where app_id = $1", [app]);
  await pool.query("delete from rum_pageview where app_id = $1", [app]);
  await pool.query("delete from rum_session where app_id = $1", [app]);
}

beforeAll(async () => {
  if (!url) return;
  const c = await pool.connect();
  try {
    for (const file of migrations()) await c.query(readFileSync(file, "utf8"));
    for (const app of [APP, OTHER_APP]) {
      await c.query(
        `insert into app_registry (app_id, name, active) values ($1, $1, true)
         on conflict (app_id) do update set active = true`,
        [app],
      );
    }
  } finally {
    c.release();
  }
}, 180_000);

afterAll(async () => {
  if (url) await pool.end();
});

suite("rum_event_index — projection, idempotence et confidentialité", () => {
  it("écrit un payload custom hostile sans dépasser la contrainte v68", async () => {
    await clean(APP);
    try {
      const rows = oversizedEventLot();
      await writeRows(pool, rows);
      const stored = (await pool.query<{ kind: string; bytes: number; props: Record<string, unknown> }>(
        `select jsonb_typeof(props) as kind, octet_length(props::text)::int as bytes, props
           from rum_event where app_id=$1 and name='oversized'`,
        [APP],
      )).rows[0];
      expect(stored.kind).toBe("object");
      expect(stored.bytes).toBeLessThanOrEqual(16 * 1024);
      expect(JSON.stringify(stored.props)).not.toContain("sk-live-secret");
    } finally {
      await clean(APP);
    }
  });

  it("indexe une seule fois chaque signal source et ne change pas le métering", async () => {
    await clean(APP);
    const rows = lot();
    try {
      await writeRows(pool, rows);
      await writeRows(pool, rows);
      const expected = rows.eventIndex.length;
      expect(expected).toBe(8);
      expect(Number((await pool.query("select count(*)::int as n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(expected);
      expect(Number((await pool.query("select count(*)::int as n from rum_pageview where app_id=$1", [APP])).rows[0].n)).toBe(1);
      expect(Number((await pool.query("select count(*)::int as n from rum_metric where app_id=$1", [APP])).rows[0].n)).toBe(1);

      await pool.query("select meter_tenant_usage(current_date)");
      const usage = (await pool.query<{ events: number }>(
        "select events::int from tenant_usage_daily where app_id=$1 and day=current_date", [APP],
      )).rows[0];
      expect(Number(usage.events)).toBe(expected);

      const columns = (await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='rum_event_index'`,
      )).rows.map((r) => r.column_name);
      for (const forbidden of ["visitor_id", "user_hash", "user_agent", "url", "message", "stack", "props", "body"])
        expect(columns).not.toContain(forbidden);
      const indexed = (await pool.query<{ route: string; source_name: string | null }>(
        "select route, source_name from rum_event_index where app_id=$1 and kind='event'", [APP],
      )).rows[0];
      expect(indexed.route).toBe("/checkout");
      expect(JSON.stringify(indexed)).not.toContain("jane@example.test");
      expect(JSON.stringify(indexed)).not.toContain("sk-live-secret");
    } finally {
      await clean(APP);
    }
  });

  it("reprend l'identité canonique d'un vital CLS consolidé", async () => {
    await clean(APP);
    try {
      await writeRows(pool, vitalsConsolides());
      const metrics = await pool.query<{ span_id: string; value: number }>(
        "select span_id, value from rum_metric where app_id=$1 and name='CLS'", [APP],
      );
      expect(metrics.rows).toEqual([{ span_id: "00000000000001a2", value: 0.2 }]);
      const index = await pool.query<{ source_span_id: string }>(
        "select source_span_id from rum_event_index where app_id=$1 and kind='vital'", [APP],
      );
      expect(index.rows).toEqual([{ source_span_id: "00000000000001a2" }]);
    } finally {
      await clean(APP);
    }
  });

  it("purge, effacement d'app et effacement de session enlèvent aussi la projection", async () => {
    await clean(APP);
    try {
      await writeRows(pool, lot());
      await pool.query("select erase_session($1)", ["p1-index-session"]);
      expect(Number((await pool.query("select count(*)::int as n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(0);

      await writeRows(pool, lot(APP, "p1-index-purge"));
      await pool.query("select purge_rum_app($1, now() + interval '1 minute')", [APP]);
      expect(Number((await pool.query("select count(*)::int as n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(0);

      await writeRows(pool, lot(APP, "p1-index-app-erase"));
      await pool.query("select erase_app_data($1)", [APP]);
      expect(Number((await pool.query("select count(*)::int as n from rum_event_index where app_id=$1", [APP])).rows[0].n)).toBe(0);
    } finally {
      await clean(APP);
    }
  });

  it("autorise la même identité native dans deux tenants distincts", async () => {
    await clean(APP);
    await clean(OTHER_APP);
    const native = "abcdefabcdefabcd";
    try {
      for (const app of [APP, OTHER_APP]) {
        await pool.query(
          `insert into rum_event_index (app_id, session_id, ts, route, kind, source_name, source_span_id)
           values ($1, $2, now(), '/checkout', 'event', 'track', $3)`,
          [app, `${app}-session`, native],
        );
      }
      const rows = await pool.query<{ app_id: string }>(
        "select app_id from rum_event_index where source_span_id=$1 order by app_id", [native],
      );
      expect(rows.rows).toEqual([{ app_id: APP }, { app_id: OTHER_APP }]);
    } finally {
      await clean(APP);
      await clean(OTHER_APP);
    }
  });
});

suite("rum_event_index — RLS fail-closed", () => {
  it("ne révèle que l'app de la GUC console_ro, et rien sans scope", async () => {
    await clean(APP);
    await clean(OTHER_APP);
    const c = await pool.connect();
    try {
      await writeRows(pool, lot(APP, "p1-index-a-session"));
      await writeRows(pool, lot(OTHER_APP, "p1-index-b-session"));
      await c.query("select set_config('app.current_app_id', '', false)");
      await c.query("set role console_ro");
      expect(Number((await c.query("select count(*)::int as n from rum_event_index")).rows[0].n)).toBe(0);
      await c.query("reset role");
      await c.query("select set_config('app.current_app_id', $1, false)", [APP]);
      await c.query("set role console_ro");
      const scoped = await c.query<{ app_id: string }>("select distinct app_id from rum_event_index order by app_id");
      expect(scoped.rows).toEqual([{ app_id: APP }]);
      await c.query("reset role");
    } finally {
      await c.query("reset role").catch(() => {});
      c.release();
      await clean(APP);
      await clean(OTHER_APP);
    }
  });
});
