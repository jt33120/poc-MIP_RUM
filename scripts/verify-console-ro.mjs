// QA-fix #1 — prouve sur Postgres réel que la console (rôle restreint console_ro,
// SANS BYPASSRLS, cf. DEPLOY.md) lit/écrit bien les tables v0.8 SOUS RLS :
// rum_rollup_hourly (v12), sourcemap (v13), tenant_usage_daily (v15). Sans les blocs
// cro_* ajoutés à ces migrations, ces accès échoueraient (0 ligne en lecture,
// permission denied à l'upload) une fois déployés — alors que CI/local (connexion
// propriétaire) restent verts. C'est le piège « CI vert ≠ prod OK ».
//   pg_virtualenv node scripts/verify-console-ro.mjs
// ou : DATABASE_URL=postgres://… (superuser) node scripts/verify-console-ro.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../apps/ingest/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...["02","03","04","05","07","08","09","10","11","12","13","14","15"].map((n) => `migration-v${n}.sql`)];

async function applyAll(c) {
  for (const f of MIGR) {
    try { await c.query(await readFile(SQL(f), "utf8")); }
    // on ne tolère QUE l'absence d'extensions cloud (pg_cron/pg_net) ; surtout PAS
    // les erreurs liées à console_ro / aux policies (qu'on teste justement).
    catch (e) { if (!/pg_cron|pg_net|cron\.|net\.|extension/i.test(String(e.message))) throw e; }
  }
}

function assert(label, cond) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();

  // Le rôle restreint de la console DOIT exister AVANT les migrations pour que les
  // blocs gardés (grant + policy cro_*) s'exécutent — exactement comme sur le cloud.
  await c.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if;
  end $$;`);
  await c.query("grant usage on schema public to console_ro");

  await applyAll(c);

  // Données posées par le PROPRIÉTAIRE (comme l'ingestion service_role / pg_cron).
  await c.query("insert into app_registry (app_id, name) values ('app-a','A')");
  await c.query("insert into rum_session (session_id, app_id, device_type) values ('s1','app-a','mobile')");
  await c.query(`insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
                 values ('s1','app-a','/x','LCP',2000,'good', now() - interval '1 hour')`);
  await c.query(`insert into rum_pageview (session_id, app_id, route, started_at)
                 values ('s1','app-a','/x', now() - interval '1 hour')`);
  await c.query("select refresh_rum_rollups(48)");
  await c.query(`insert into sourcemap (app_id, release, filename, content, size_bytes)
                 values ('app-a','1.0.0','main.js','{"version":3,"mappings":""}', 30)`);
  await c.query(`insert into tenant_usage_daily (app_id, day, events, sessions, errors)
                 values ('app-a', current_date, 5, 1, 1)`);

  // Référence propriétaire (bypass RLS) : ce qui existe réellement.
  const n = async (t) => Number((await c.query(`select count(*) n from ${t}`)).rows[0].n);
  const owner = { rollup: await n("rum_rollup_hourly"), smap: await n("sourcemap"), usage: await n("tenant_usage_daily") };
  assert("setup : données présentes (rollup>0, sourcemap>0, usage>0)", owner.rollup > 0 && owner.smap > 0 && owner.usage > 0);

  // RLS doit être ACTIVE sur les 3 tables (sinon le test ne prouverait rien).
  const rls = (await c.query(`select relrowsecurity from pg_class
     where relname in ('rum_rollup_hourly','sourcemap','tenant_usage_daily') and relkind='r'`)).rows;
  assert("RLS activée sur les 3 tables v0.8", rls.length === 3 && rls.every((r) => r.relrowsecurity === true));

  // Lecture SOUS console_ro (RLS appliqué : non-propriétaire, pas de bypass).
  await c.query("set role console_ro");
  const cro = { rollup: await n("rum_rollup_hourly"), smap: await n("sourcemap"), usage: await n("tenant_usage_daily") };
  assert("console_ro LIT rum_rollup_hourly (== propriétaire, ≠0)", cro.rollup === owner.rollup && cro.rollup > 0);
  assert("console_ro LIT sourcemap (== propriétaire, ≠0)", cro.smap === owner.smap && cro.smap > 0);
  assert("console_ro LIT tenant_usage_daily (== propriétaire, ≠0)", cro.usage === owner.usage && cro.usage > 0);

  // Upload admin = upsert d'une source map, sous console_ro.
  let uploadOk = true;
  try {
    await c.query(`insert into sourcemap (app_id, release, filename, content, size_bytes)
                   values ('app-a','1.0.0','main.js','{"version":3,"mappings":";;"}', 33)
                   on conflict (app_id, release, filename) do update
                     set content = excluded.content, size_bytes = excluded.size_bytes`);
  } catch { uploadOk = false; }
  assert("console_ro UPSERTE une source map (chemin upload admin)", uploadOk);
  await c.query("reset role");

  // Isolement : un rôle SANS policy ne voit rien malgré le privilège table (RLS).
  await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname='intruder') then create role intruder nologin; end if; end $$;");
  await c.query("grant usage on schema public to intruder");
  await c.query("grant select on rum_rollup_hourly, sourcemap, tenant_usage_daily to intruder");
  await c.query("set role intruder");
  const intr = { rollup: await n("rum_rollup_hourly"), smap: await n("sourcemap") };
  await c.query("reset role");
  assert("sans policy, RLS masque tout (rôle quelconque voit 0)", intr.rollup === 0 && intr.smap === 0);

  await c.end();
  console.log(process.exitCode ? "\n[verify-console-ro] ÉCHEC." : "\n[verify-console-ro] accès console_ro v0.8 sous RLS VÉRIFIÉ.");
}

main().catch((e) => { console.error("[verify-console-ro] échec:", e?.message ?? e); process.exit(2); });
