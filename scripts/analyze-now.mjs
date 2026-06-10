// Analyse instantanée de la base cloud MIP RUM (lecture seule, secrets via fichiers)
import { readFileSync } from "node:fs";
import pg from "pg";

const ROOT = "/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/mip-rum";
const CA = readFileSync(`${ROOT}/apps/console/certs/supabase-ca.crt`, "utf8");
const env = readFileSync(`${ROOT}/apps/console/.env.production`, "utf8");
const u = new URL(env.match(/^DATABASE_URL=(.+)$/m)[1]);
const TEST_SESSIONS = [
  "e2f93f4d-c0f0-46a6-94ca-9aa3f5ac5866",
  "f5ec7635-88d6-4514-bd61-3fc6c9b0d0be",
];

const db = new pg.Client({
  host: u.hostname, port: Number(u.port), database: u.pathname.slice(1),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  ssl: { ca: CA },
});
await db.connect();
const q = async (label, sql, params = []) => {
  const { rows } = await db.query(sql, params);
  console.log(`\n=== ${label} ===`);
  console.table(rows);
};

await q("Sessions (toutes, avec marquage test)", `
  select s.session_id, s.started_at, s.last_seen_at, s.device_type, s.user_agent is not null as ua,
         s.page_count, s.session_id = any($1) as is_test_build,
         (select count(*) from rum_metric m where m.session_id = s.session_id) as metrics,
         (select count(*) from rum_error e where e.session_id = s.session_id) as errors
  from rum_session s where s.app_id = 'gip-plateforme' order by s.started_at`, [TEST_SESSIONS]);

await q("Vitals p75 par route (hors sessions de test)", `
  select route, name, count(*) as n,
         round(percentile_cont(0.75) within group (order by value)::numeric, 1) as p75,
         mode() within group (order by rating) as rating_majoritaire
  from rum_metric where app_id='gip-plateforme' and not (session_id = any($1))
  group by route, name order by route, name`, [TEST_SESSIONS]);

await q("Pageviews par route (hors test)", `
  select route, nav_type, count(*) as n
  from rum_pageview where app_id='gip-plateforme' and not (session_id = any($1))
  group by route, nav_type order by n desc`, [TEST_SESSIONS]);

await q("Erreurs JS (toutes)", `
  select kind, error_type, left(message, 80) as message, route, count(*) as n, max(ts) as last_seen
  from rum_error where app_id='gip-plateforme'
  group by 1,2,3,4 order by n desc limit 10`);

await q("Navigateurs / devices (hors test)", `
  select device_type, left(coalesce(user_agent,'?'), 70) as ua, count(*) as sessions
  from rum_session where app_id='gip-plateforme' and not (session_id = any($1))
  group by 1,2 order by 3 desc`, [TEST_SESSIONS]);

await q("Corrélation (buckets avec RUM réel)", `
  select to_char(bucket, 'DD/MM HH24:MI') as bucket, route,
         round(syn_latency_avg::numeric) as robot_ms, round(rum_lcp_p75::numeric) as reel_lcp_p75_ms,
         rum_sessions, syn_state
  from v_correlation where app_id='gip-plateforme' and rum_lcp_p75 is not null
  order by bucket desc limit 12`);

await db.end();
