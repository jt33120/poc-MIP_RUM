// P1 — auto-observabilité : prouve sur Postgres réel que le snapshot de santé interne
// (internalHealth) compte correctement l'ingestion récente, les alertes/livraisons et
// le retard de métering, ET qu'il est lisible sous console_ro (v16).
//   pg_virtualenv node scripts/verify-health.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../apps/ingest/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...["02","03","04","05","07","08","09","10","11","12","13","14","15","16","19"].map((n) => `migration-v${n}.sql`)];

// Requête identique à lib/queries-health.ts.
const HEALTH = `select
  (select count(*) from rum_metric   where ts > now() - interval '5 minutes')::int as ingest_metrics_5m,
  (select count(*) from rum_pageview where started_at > now() - interval '5 minutes')::int as ingest_pageviews_5m,
  (select count(*) from rum_error    where ts > now() - interval '5 minutes')::int as ingest_errors_5m,
  (select count(distinct session_id) from rum_pageview where started_at > now() - interval '5 minutes')::int as ingest_sessions_5m,
  (select count(*) from app_registry where active)::int as apps_active,
  (select count(*) from alert_event where not acknowledged)::int as alerts_unacked,
  (select count(*) from alert_delivery where status = 'queued')::int as deliveries_queued,
  (select count(*) from alert_delivery where status = 'failed')::int as deliveries_failed,
  (select count(*) from alert_delivery where status = 'dead')::int as deliveries_dead,
  (select extract(epoch from (now() - max(metered_at))) / 3600.0 from tenant_usage_daily)::float as metering_lag_hours`;

async function applyAll(c) {
  for (const f of MIGR) {
    try { await c.query(await readFile(SQL(f), "utf8")); }
    catch (e) { if (!/pg_cron|pg_net|cron\.|net\.|extension/i.test(String(e.message))) throw e; }
  }
}
function assert(label, cond) { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) process.exitCode = 1; }

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if; end $$;");
  await c.query("grant usage on schema public to console_ro");
  await applyAll(c);

  await c.query("insert into app_registry (app_id, name) values ('app-a','A'),('app-b','B')");
  await c.query("insert into rum_session (session_id, app_id) values ('s1','app-a'),('s2','app-a')");
  // ingestion récente (<5 min) + une ancienne (ignorée)
  await c.query(`insert into rum_metric (session_id,app_id,route,name,value,rating,ts) values
    ('s1','app-a','/x','LCP',1500,'good', now()-interval '1 min'),
    ('s1','app-a','/x','INP',120,'good', now()-interval '2 min'),
    ('s2','app-a','/x','LCP',1800,'good', now()-interval '3 min'),
    ('s1','app-a','/x','LCP',9000,'poor', now()-interval '20 min')`);
  await c.query(`insert into rum_pageview (session_id,app_id,route,started_at) values
    ('s1','app-a','/x', now()-interval '1 min'), ('s2','app-a','/y', now()-interval '2 min')`);
  await c.query(`insert into rum_error (session_id,app_id,route,kind,message,ts) values
    ('s1','app-a','/x','error','boom', now()-interval '1 min')`);
  // alertes + livraisons (statuts variés)
  await c.query(`insert into alert_rule (app_id, metric, comparator, threshold) values ('app-a','LCP','>',2000)`);
  await c.query(`insert into alert_event (rule_id, value, message, acknowledged)
    select id, 5000, 'x', false from alert_rule limit 1`);
  await c.query(`insert into alert_delivery (alert_event_id, target, status)
    select ae.id, 'http://h', s from alert_event ae, (values ('queued'),('failed'),('dead'),('sent')) v(s)`);
  // métering daté d'il y a ~26 h
  await c.query(`insert into tenant_usage_daily (app_id, day, events, metered_at)
    values ('app-a', current_date-1, 10, now()-interval '26 hours')`);

  const h = (await c.query(HEALTH)).rows[0];
  assert("ingestion 5 min : 3 metrics récents (1 ancien ignoré)", h.ingest_metrics_5m === 3);
  assert("ingestion 5 min : 2 pages vues, 1 erreur, 2 sessions",
    h.ingest_pageviews_5m === 2 && h.ingest_errors_5m === 1 && h.ingest_sessions_5m === 2);
  assert("apps actives ≥ 2 (app-a, app-b + seeds éventuels)", h.apps_active >= 2);
  assert("alertes non acquittées = 1", h.alerts_unacked === 1);
  assert("livraisons queued/failed/dead = 1/1/1",
    h.deliveries_queued === 1 && h.deliveries_failed === 1 && h.deliveries_dead === 1);
  assert("retard métering ≈ 26 h", h.metering_lag_hours >= 25.9 && h.metering_lag_hours <= 26.2);

  // lecture sous console_ro (toutes les tables sont couvertes par v16)
  await c.query("set role console_ro");
  const cro = (await c.query(HEALTH)).rows[0];
  await c.query("reset role");
  assert("console_ro exécute le snapshot (== propriétaire)",
    cro.ingest_metrics_5m === 3 && cro.alerts_unacked === 1 && cro.apps_active === h.apps_active);

  await c.end();
  console.log(process.exitCode ? "\n[verify-health] ÉCHEC." : "\n[verify-health] santé interne (snapshot + console_ro) VÉRIFIÉ.");
}
main().catch((e) => { console.error("[verify-health] échec:", e?.message ?? e); process.exit(2); });
