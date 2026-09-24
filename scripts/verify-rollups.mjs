// Vérifie que les rollups de migration-v12 produisent EXACTEMENT les mêmes
// résultats que les requêtes sur lignes brutes (Δ=0), pour les vues que la console
// bascule sur le rollup : heatmap santé (healthGrid) et trafic quotidien (dailyTraffic).
// Esprit identique à labs/clickhouse/bench.mjs (preuve d'équivalence).
//
// Usage (Postgres éphémère) :
//   pg_virtualenv node scripts/verify-rollups.mjs
// ou contre une base existante :
//   DATABASE_URL=postgres://… node scripts/verify-rollups.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SCHEMA = new URL("../packages/db/sql/schema.sql", import.meta.url);
const MIGRATION = new URL("../packages/db/sql/migration-v12.sql", import.meta.url);

// --- requêtes console : BRUT vs ROLLUP (mêmes paramètres $1=app, $2=device) ----
const RAW_GRID = `
  select date_trunc('day', m.ts) as day, extract(hour from m.ts)::int as hour,
         sum(case when m.rating='good' then (case when m.name='LCP' then 2 else 1 end) else 0 end)::float as good_w,
         sum(case when m.name='LCP' then 2 else 1 end)::float as total_w
  from rum_metric m left join rum_session s using (session_id)
  where m.ts >= date_trunc('hour', now()) - interval '14 days' and ($1::text is null or m.app_id=$1) and ($2::text is null or s.device_type=$2)
  group by 1,2 order by 1,2`;
const ROLLUP_GRID = `
  select date_trunc('day', hour) as day, extract(hour from hour)::int as hour,
         sum(good_w)::float as good_w, sum(total_w)::float as total_w
  from rum_rollup_hourly
  where hour >= date_trunc('hour', now()) - interval '14 days' and ($1::text is null or app_id=$1) and ($2::text is null or device_type=$2)
  group by 1,2 having sum(total_w) > 0 order by 1,2`;

const RAW_TRAFFIC = `
  select gs.day::date as day, coalesce(pv.n,0)::int as pageviews, coalesce(er.n,0)::int as errors
  from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') gs(day)
  left join (select date_trunc('day', p.started_at) d, count(*)::int n from rum_pageview p left join rum_session s using (session_id)
             where p.started_at >= date_trunc('hour', now()) - interval '14 days' and ($1::text is null or p.app_id=$1) and ($2::text is null or s.device_type=$2) group by 1) pv on pv.d=gs.day
  left join (select date_trunc('day', e.ts) d, count(*)::int n from rum_error e left join rum_session s using (session_id)
             where e.ts >= date_trunc('hour', now()) - interval '14 days' and ($1::text is null or e.app_id=$1) and ($2::text is null or s.device_type=$2) group by 1) er on er.d=gs.day
  order by 1`;
const ROLLUP_TRAFFIC = `
  select gs.day::date as day, coalesce(pv.n,0)::int as pageviews, coalesce(er.n,0)::int as errors
  from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') gs(day)
  left join (select date_trunc('day', hour) d, sum(pageviews)::int n from rum_rollup_hourly
             where hour >= date_trunc('hour', now()) - interval '14 days' and ($1::text is null or app_id=$1) and ($2::text is null or device_type=$2) group by 1) pv on pv.d=gs.day
  left join (select date_trunc('day', hour) d, sum(errors)::int n from rum_rollup_hourly
             where hour >= date_trunc('hour', now()) - interval '14 days' and ($1::text is null or app_id=$1) and ($2::text is null or device_type=$2) group by 1) er on er.d=gs.day
  order by 1`;

const norm = (rows) => JSON.stringify(rows.map((r) => ({ ...r, day: r.day instanceof Date ? r.day.toISOString() : r.day })));

async function seed(c) {
  // 3 jours, 2 apps, 2 devices + des metrics sans session (device inconnu).
  await c.query(`insert into rum_session (session_id, app_id, device_type) values
    ('s-mob','app-a','mobile'), ('s-desk','app-a','desktop'), ('s-b','app-b','mobile')`);
  // metrics répartis sur quelques heures/jours (offsets en heures depuis maintenant)
  const M = [
    // [app, session|null, name, value, rating, hoursAgo]
    ["app-a", "s-mob", "LCP", 2200, "good", 2],
    ["app-a", "s-mob", "INP", 150, "good", 2],
    ["app-a", "s-desk", "LCP", 5000, "poor", 2],
    ["app-a", "s-desk", "CLS", 0.05, "good", 26],
    ["app-a", null, "FCP", 1600, "good", 50],     // session inconnue -> device ''
    ["app-b", "s-b", "LCP", 2400, "good", 3],
    ["app-b", "s-b", "TTFB", 700, "good", 73],
  ];
  for (const [app, sess, name, value, rating, h] of M)
    await c.query(
      `insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
       values ($1,$2,'/x',$3,$4,$5, now() - make_interval(hours => $6))`,
      [sess, app, name, value, rating, h]);
  const PV = [["app-a", "s-mob", 2], ["app-a", "s-desk", 26], ["app-a", null, 50], ["app-b", "s-b", 3]];
  for (const [app, sess, h] of PV)
    await c.query(`insert into rum_pageview (session_id, app_id, route, started_at)
                   values ($1,$2,'/x', now() - make_interval(hours => $3))`, [sess, app, h]);
  const ER = [["app-a", "s-desk", 26], ["app-b", "s-b", 3]];
  for (const [app, sess, h] of ER)
    await c.query(`insert into rum_error (session_id, app_id, route, kind, message, ts)
                   values ($1,$2,'/x','error','boom', now() - make_interval(hours => $3))`, [sess, app, h]);

  // Cas-bord de la fenêtre 14 j : des métriques à offset SOUS-horaire autour de la
  // frontière (où brut `ts` et rollup `date_trunc('hour',ts)` divergeaient avant le
  // fix). Le filtre aligné `>= date_trunc('hour', now()) - 14d` doit donner Δ=0.
  const BOUNDARY = [
    "date_trunc('hour', now()) - interval '14 days' + interval '1 minute'",  // pile au bord (cas Cowork)
    "date_trunc('hour', now()) - interval '14 days' + interval '37 minutes'",
    "date_trunc('hour', now()) - interval '14 days' - interval '20 minutes'", // juste avant
    "now() - interval '14 days' + interval '1 minute'",                       // bord non aligné sur l'heure
  ];
  for (const expr of BOUNDARY)
    await c.query(
      `insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
       values ('s-mob','app-a','/x','LCP',2100,'good', ${expr})`);
}

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await c.query(await readFile(SCHEMA, "utf8"));
  await c.query(await readFile(MIGRATION, "utf8"));
  await seed(c);
  await c.query("select refresh_rum_rollups(24 * 40)"); // couvre les données semées

  const cases = [
    ["healthGrid app=null device=null", RAW_GRID, ROLLUP_GRID, [null, null]],
    ["healthGrid app=app-a device=null", RAW_GRID, ROLLUP_GRID, ["app-a", null]],
    ["healthGrid app=null device=mobile", RAW_GRID, ROLLUP_GRID, [null, "mobile"]],
    ["dailyTraffic app=null device=null", RAW_TRAFFIC, ROLLUP_TRAFFIC, [null, null]],
    ["dailyTraffic app=app-a device=desktop", RAW_TRAFFIC, ROLLUP_TRAFFIC, ["app-a", "desktop"]],
    ["dailyTraffic app=app-b device=null", RAW_TRAFFIC, ROLLUP_TRAFFIC, ["app-b", null]],
  ];

  let ok = true;
  for (const [label, rawSql, rollupSql, params] of cases) {
    const raw = norm((await c.query(rawSql, params)).rows);
    const roll = norm((await c.query(rollupSql, params)).rows);
    const equal = raw === roll;
    ok &&= equal;
    console.log(`${equal ? "✓ Δ=0" : "✗ ÉCART"}  ${label}`);
    if (!equal) { console.log("  brut  :", raw); console.log("  rollup:", roll); }
  }
  await c.end();
  console.log(ok ? "\n[verify-rollups] ÉGALITÉ rollup == brut VÉRIFIÉE (Δ=0)." : "\n[verify-rollups] ÉCARTS — voir ci-dessus.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("[verify-rollups] échec:", e?.message ?? e); process.exit(2); });
