// P0 #5 — isolation multi-tenant : prouve sur Postgres réel le métering d'usage
// par client (meter_tenant_usage, durable) et le statut de quota (tenant_quota_status,
// fail-open). migration-v15.
//   pg_virtualenv node scripts/verify-tenant.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../apps/ingest/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...["02","03","04","05","07","08","09","10","11","12","13","14","15"].map((n) => `migration-v${n}.sql`)];

async function applyAll(c) {
  for (const f of MIGR) {
    try { await c.query(await readFile(SQL(f), "utf8")); }
    catch (e) { if (!/pg_cron|pg_net|role|extension|cron\.|net\./i.test(String(e.message))) throw e; }
  }
}

// Insère de la télémétrie datée d'hier midi (squarement dans le jour metré).
async function seed(c, app, { metrics = 0, errors = 0, pageviews = 0 }) {
  const ts = "(current_date - 1)::timestamptz + interval '12 hours'";
  await c.query(`insert into rum_session (session_id, app_id, last_seen_at) values ($1,$2, ${ts})`, [`${app}-s`, app]);
  for (let i = 0; i < pageviews; i++)
    await c.query(`insert into rum_pageview (session_id, app_id, route, started_at) values ($1,$2,'/x', ${ts})`, [`${app}-s`, app]);
  for (let i = 0; i < metrics; i++)
    await c.query(`insert into rum_metric (session_id, app_id, route, name, value, rating, ts) values ($1,$2,'/x','LCP',2000,'good', ${ts})`, [`${app}-s`, app]);
  for (let i = 0; i < errors; i++)
    await c.query(`insert into rum_error (session_id, app_id, route, kind, message, ts) values ($1,$2,'/x','error','boom', ${ts})`, [`${app}-s`, app]);
}

const usage = async (c, app) => (await c.query("select events, sessions, errors from tenant_usage_daily where app_id=$1 and day=current_date-1", [app])).rows[0];
const quota = async (c, app) => (await c.query("select tenant_quota_status($1) as s", [app])).rows[0].s;

function assert(label, cond) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await applyAll(c);

  // app-a : quota 3 (sera dépassé) ; app-b : illimité
  await c.query(`insert into app_registry (app_id, name, monthly_quota) values ('app-a','A',3),('app-b','B',null)`);
  await seed(c, "app-a", { metrics: 3, errors: 1, pageviews: 1 }); // events = 3+1+1 = 5
  await seed(c, "app-b", { metrics: 1, pageviews: 1 });            // events = 2

  await c.query("select meter_tenant_usage()"); // hier

  const a = await usage(c, "app-a");
  assert("app-a : events=5 (3 metrics + 1 error + 1 pageview)", Number(a.events) === 5);
  assert("app-a : sessions=1, errors=1", Number(a.sessions) === 1 && Number(a.errors) === 1);
  const b = await usage(c, "app-b");
  assert("app-b : events=2", Number(b.events) === 2);

  const qa = await quota(c, "app-a");
  assert("quota app-a : used=5, quota=3, over=true", Number(qa.used) === 5 && Number(qa.quota) === 3 && qa.over === true);
  const qb = await quota(c, "app-b");
  assert("quota app-b : illimité → over=false (fail-open)", qb.quota === null && qb.over === false);

  // usage mensuel agrégé
  const m = (await c.query("select events from v_tenant_usage_month where app_id='app-a' and month=date_trunc('month',current_date)::date")).rows[0];
  assert("v_tenant_usage_month app-a : 5", Number(m.events) === 5);

  // idempotence : re-métrer ne double pas
  await c.query("select meter_tenant_usage()");
  assert("meter idempotent (toujours 5, pas de doublon)", Number((await usage(c, "app-a")).events) === 5);

  await c.end();
  console.log(process.exitCode ? "\n[verify-tenant] ÉCHEC." : "\n[verify-tenant] métering + quotas VÉRIFIÉS.");
}

main().catch((e) => { console.error("[verify-tenant] échec:", e?.message ?? e); process.exit(2); });
