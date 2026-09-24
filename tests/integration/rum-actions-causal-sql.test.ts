import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../packages/backend/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "p3-actions-causal";
const OTHER_APP = "p3-actions-causal-other";
const ACTION = "33333333-4444-4555-8666-777777777777";
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const kv = (key: string, value: string | number) => ({
  key,
  value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
});

function rows() {
  const now = Date.now();
  const common = { "mip.session_id": "p3-actions-session", "mip.route": "/checkout" };
  const span = (name: string, spanId: string, attrs: Record<string, string | number>, offsetMs = 0) => ({
    name,
    spanId,
    traceId: "a".repeat(32),
    startTimeUnixNano: String(BigInt(now + offsetMs) * 1_000_000n),
    endTimeUnixNano: String(BigInt(now + offsetMs + 10) * 1_000_000n),
    attributes: Object.entries({ ...common, ...attrs }).map(([key, value]) => kv(key, value)),
  });
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: [kv("mip.app_id", APP)] },
      scopeSpans: [{ spans: [
        span("rum.action", "00000000000000a1", {
          "mip.event_type": "action", "mip.event_name": "Payer", "mip.action_type": "click",
          "mip.action_id": ACTION, "mip.context": JSON.stringify({ plan: "pro" }),
        }),
        span("exception", "00000000000000a2", {
          "mip.action_id": ACTION, "exception.type": "Error", "exception.message": "boom",
        }),
        span("resource", "00000000000000a3", {
          "mip.action_id": ACTION, "resource.url": "https://app.test/pay.js",
          "resource.type": "script", "resource.duration_ms": 30,
        }),
        span("http.client", "00000000000000a4", {
          "mip.action_id": ACTION, "mip.trace_id": "b".repeat(32), "mip.span_id": "00000000000000b4",
          "http.url": "https://app.test/api/pay", "http.method": "POST",
          "http.status_code": 200, "http.duration_ms": 120,
        }),
        // Appel rapide antérieur à la même URL : aucun ResourceTiming filtré
        // ne lui correspond. Le matching doit choisir l'API proche, pas le
        // premier rang indépendant de chaque ensemble.
        span("http.client", "00000000000000ae", {
          "mip.action_id": ACTION, "mip.trace_id": "d".repeat(32), "mip.span_id": "00000000000000be",
          "http.url": "https://app.test/api/pay", "http.method": "POST",
          "http.status_code": 200, "http.duration_ms": 10,
        }, -2_000),
        span("frustration", "00000000000000a5", {
          "mip.action_id": ACTION, "frustration.kind": "error", "frustration.target": "Payer",
        }),
        span("breadcrumb", "00000000000000a6", {
          "mip.action_id": ACTION, "breadcrumb.type": "click", "breadcrumb.label": "Payer",
          "breadcrumb.seq": 1,
        }),
        span("exception", "00000000000000a7", {
          "mip.action_id": ACTION, "exception.type": "Error", "exception.message": "boom again",
          "mip.error_count": 4,
        }),
        span("resource", "00000000000000a8", {
          "mip.action_id": ACTION, "resource.url": "https://app.test/pay.css",
          "resource.type": "stylesheet", "resource.duration_ms": 20,
        }),
        // Le Resource Timing API et l'instrumentation fetch voient le même
        // appel. Il reste stocké pour le diagnostic brut, mais Top Actions ne
        // doit compter ni sa durée ni son occurrence deux fois.
        span("resource", "00000000000000aa", {
          "mip.action_id": ACTION, "resource.url": "https://app.test/api/pay",
          "resource.type": "fetch", "resource.duration_ms": 120,
        }),
        // Même URL et même fenêtre, mais deuxième occurrence : un seul span
        // API ne doit en dédupliquer qu'une, jamais les deux.
        span("resource", "00000000000000ad", {
          "mip.action_id": ACTION, "resource.url": "https://app.test/api/pay",
          "resource.type": "fetch", "resource.duration_ms": 130,
        }),
        span("http.client", "00000000000000a9", {
          "mip.action_id": ACTION, "mip.trace_id": "c".repeat(32), "mip.span_id": "00000000000000b9",
          "http.url": "https://app.test/api/confirm", "http.method": "GET",
          "http.status_code": 200, "http.duration_ms": 80,
        }),
      ] }],
    }],
  }, { now });
}

async function clean() {
  for (const app of [APP, OTHER_APP]) {
    await pool.query("delete from ingest_raw where app_id=$1", [app]);
    await pool.query("delete from rum_event_index where app_id=$1", [app]);
    await pool.query("delete from rum_action where app_id=$1", [app]);
    for (const table of ["rum_error", "rum_resource", "rum_breadcrumb", "rum_event", "rum_span", "rum_pageview", "rum_metric", "rum_longtask"])
      await pool.query(`delete from ${table} where app_id=$1`, [app]);
    await pool.query("delete from rum_session where app_id=$1", [app]);
    await pool.query("delete from route_pattern where app_id=$1", [app]);
    await pool.query("delete from route_registry where app_id=$1", [app]);
    await pool.query("delete from route_cardinality where app_id=$1", [app]);
  }
}

beforeAll(async () => {
  if (!url) return;
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  const files = readdirSync(SQL_DIR)
    .filter((file) => /^migration-v\d+\.sql$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  for (const file of files) await pool.query(readFileSync(join(SQL_DIR, file), "utf8"));
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
  await pool.query("delete from app_registry where app_id = any($1::text[])", [[APP, OTHER_APP]]);
  await pool.end();
});

suite("P3 actions causales — PostgreSQL", () => {
  it("écrit la racine et tous les effets avec le même ID sans multiplication", async () => {
    await writeRows(pool, rows());
    await writeRows(pool, rows()); // rejeu strictement idempotent du même lot
    expect((await pool.query("select name,type,context from rum_action where action_id=$1", [ACTION])).rows[0])
      .toEqual({ name: "Payer", type: "click", context: { plan: "pro" } });
    for (const [table, expected] of Object.entries({ rum_error: 2, rum_resource: 4, rum_breadcrumb: 1, rum_span: 3 }))
      expect(Number((await pool.query(`select count(*)::int n from ${table} where action_id=$1`, [ACTION])).rows[0].n)).toBe(expected);
    const aggregate = (await pool.query(
      `with e as (select action_id, count(*) n from rum_error where action_id=$1 group by action_id),
            r as (select action_id, count(*) n from rum_resource where action_id=$1 group by action_id),
            p as (select action_id, count(*) n from rum_span where action_id=$1 group by action_id)
       select count(*)::int actions, max(e.n)::int errors, max(r.n)::int resources, max(p.n)::int api_calls
         from rum_action a left join e using(action_id) left join r using(action_id) left join p using(action_id)
        where a.action_id=$1`,
      [ACTION],
    )).rows[0];
    expect(aggregate).toEqual({ actions: 1, errors: 2, resources: 4, api_calls: 3 });
  });

  it("normalise rum_action à l'insertion et pendant le backfill v67", async () => {
    await clean();
    await writeRows(pool, rows());
    await pool.query(
      `insert into route_pattern (app_id, motif, remplacement, priorite)
       values ($1, '^/commande/[^/]+$', '/commande/:ref', 10)`,
      [APP],
    );

    // UPDATE n'est volontairement pas couvert par le trigger : il simule une
    // ligne historique antérieure au motif.
    await pool.query("update rum_action set route='/commande/SECRET42' where action_id=$1", [ACTION]);
    const preview = await pool.query<{ route_avant: string; route_apres: string; lignes: string }>(
      "select * from mip_apercu_backfill($1)",
      [APP],
    );
    expect(preview.rows).toContainEqual({
      route_avant: "/commande/SECRET42",
      route_apres: "/commande/:ref",
      lignes: "1",
    });
    const result = (await pool.query<{ backfill_route_patterns: Record<string, number> }>(
      "select backfill_route_patterns($1)",
      [APP],
    )).rows[0].backfill_route_patterns;
    expect(result.rum_action).toBe(1);
    expect((await pool.query("select route from rum_action where action_id=$1", [ACTION])).rows[0].route)
      .toBe("/commande/:ref");

    await pool.query(
      `insert into rum_action (action_id,span_id,session_id,app_id,type,name,route,ts)
       values ('44444444-5555-4666-8777-888888888888','00000000000000ab',
               'p3-actions-session',$1,'click','Commander','/commande/NEXT99',now())`,
      [APP],
    );
    expect((await pool.query(
      "select route from rum_action where action_id='44444444-5555-4666-8777-888888888888'",
    )).rows[0].route).toBe("/commande/:ref");
    const trigger = (await pool.query<{ definition: string }>(
      `select pg_get_triggerdef(oid) as definition from pg_trigger
        where tgrelid='rum_action'::regclass and tgname='trg_route_rum_action'`,
    )).rows[0].definition;
    expect(trigger).toContain("mip_trigger_route");

    await pool.query("update app_registry set route_limit=1 where app_id=$1", [APP]);
    try {
      await pool.query(
        `insert into rum_action (action_id,span_id,session_id,app_id,type,name,route,ts)
         values ('55555555-6666-4777-8888-999999999999','00000000000000ac',
                 'p3-actions-session',$1,'click','Nouvelle route','/hors-plafond',now())`,
        [APP],
      );
      expect((await pool.query(
        "select route from rum_action where action_id='55555555-6666-4777-8888-999999999999'",
      )).rows[0].route).toBe("(other)");
    } finally {
      await pool.query("update app_registry set route_limit=2000 where app_id=$1", [APP]);
    }
  });

  it("exécute la vraie requête Top Actions avec filtres et agrégats non multipliés", async () => {
    await clean();
    await writeRows(pool, rows());
    await pool.query(
      "update rum_session set device_type='desktop', geo_country='FR' where app_id=$1",
      [APP],
    );
    await pool.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [OTHER_APP],
    );
    await pool.query(
      "insert into rum_session (session_id,app_id,device_type) values ('p3-other-session',$1,'desktop')",
      [OTHER_APP],
    );
    await pool.query(
      `insert into rum_error (span_id,session_id,app_id,kind,message,error_type,fingerprint,occurrences,action_id,ts)
       values ('00000000000000ff','p3-other-session',$1,'error','cross tenant','Error','cross',99,$2,now())`,
      [OTHER_APP, ACTION],
    );
    process.env.DATABASE_URL = url;
    const { topActions, topActionsSummary } = await import("../../apps/console/lib/queries-actions");
    const { sessionTimeline } = await import("../../apps/console/lib/queries");
    const result = await topActions({
      app: APP,
      period: "24h",
      device: "desktop",
      segment: [{ dim: "geo", op: "==", value: "FR" }],
      includeBots: false,
      includeInternal: false,
    }, { limit: 10, offset: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      app_id: APP,
      name: "Payer",
      type: "click",
      route: "/checkout",
      actions: 1,
      sessions: 1,
      errors: 5,
      error_clicks: 1,
      resources: 3,
      api_calls: 3,
      resource_ms: 180,
      api_ms: 210,
      total_ms: 390,
    });
    await expect(topActionsSummary({
      app: APP,
      period: "24h",
      device: "desktop",
      segment: [{ dim: "geo", op: "==", value: "FR" }],
      includeBots: false,
      includeInternal: false,
    })).resolves.toMatchObject({
      actions: 1,
      sessions: 1,
      errors: 5,
      resources: 3,
      api_calls: 3,
      resource_ms: 180,
      api_ms: 210,
      total_ms: 390,
    });
    const otherTimeline = await sessionTimeline("p3-other-session", OTHER_APP);
    expect(otherTimeline.find((item) => item.kind === "error")).toMatchObject({
      action_id: null, action_name: null,
    });
    await expect(topActions({
      app: APP,
      period: "24h",
      device: "mobile",
      segment: [],
    })).resolves.toEqual([]);
    const timeline = await sessionTimeline("p3-actions-session", APP);
    expect(timeline.find((item) => item.kind === "action")).toMatchObject({
      title: "Payer", action_id: ACTION, action_name: "Payer",
    });
    for (const kind of ["error", "breadcrumb", "resource", "api", "event"]) {
      expect(timeline.find((item) => item.kind === kind && item.action_id === ACTION))
        .toMatchObject({ action_name: "Payer" });
    }
    const { pool: consolePool } = await import("../../apps/console/lib/db");
    await consolePool.end();
  });

  it("conserve le dual-write par la file différée", async () => {
    await clean();
    await deposerLot(pool, APP, rows());
    await deposerLot(pool, APP, rows());
    await expect(drainerIngestRaw(pool, { log: { error() {} } })).resolves.toEqual({ drains: 2, echecs: 0 });
    expect(Number((await pool.query("select count(*)::int n from rum_action where app_id=$1", [APP])).rows[0].n)).toBe(1);
    expect(Number((await pool.query("select count(*)::int n from rum_error where action_id=$1", [ACTION])).rows[0].n)).toBe(2);
  });

  it("ne mètre pas la projection et la purge avec l'app", async () => {
    await clean();
    await writeRows(pool, rows());
    const meter = (await pool.query<{ sql: string }>(
      "select pg_get_functiondef('meter_tenant_usage(date)'::regprocedure) as sql",
    )).rows[0].sql;
    expect(meter).not.toContain("rum_action");
    await pool.query("update rum_action set ts=now() - interval '2 days' where app_id=$1", [APP]);
    await pool.query("select purge_rum_app($1, now() - interval '1 day')", [APP]);
    expect(Number((await pool.query("select count(*)::int n from rum_action where app_id=$1", [APP])).rows[0].n)).toBe(1);
    await pool.query("select purge_rum_app($1, now() + interval '1 minute')", [APP]);
    expect(Number((await pool.query("select count(*)::int n from rum_action where app_id=$1", [APP])).rows[0].n)).toBe(0);
  });

  it("efface rum_action par session puis par application", async () => {
    await clean();
    await writeRows(pool, rows());
    await pool.query("select erase_session('p3-actions-session')");
    expect(Number((await pool.query("select count(*)::int n from rum_action where app_id=$1", [APP])).rows[0].n)).toBe(0);
    await writeRows(pool, rows());
    await pool.query("select erase_app_data($1)", [APP]);
    expect(Number((await pool.query("select count(*)::int n from rum_action where app_id=$1", [APP])).rows[0].n)).toBe(0);
  });
});
