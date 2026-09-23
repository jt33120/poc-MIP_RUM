// P0 #4 — conformité : prouve sur Postgres réel (1) la rétention PAR TENANT
// (purge_rum_tenants honore app_registry.retention_days, sinon défaut) et (2) le
// droit à l'effacement (erase_app_data / erase_session). migration-v14.
//   pg_virtualenv node scripts/verify-conformite.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../packages/db/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...["02", "03", "04", "05", "07", "08", "09", "10", "11", "12", "13", "14"].map((n) => `migration-v${n}.sql`)];

async function applyAll(c) {
  for (const f of MIGR) {
    try {
      await c.query(await readFile(SQL(f), "utf8"));
    } catch (e) {
      // blocs gardés (pg_cron/pg_net/roles) peuvent broncher en local : on tolère
      if (!/pg_cron|pg_net|role|extension|cron\.|net\./i.test(String(e.message))) throw e;
    }
  }
}

async function seedApp(c, app, ages) {
  for (const d of ages) {
    const sid = `${app}-${d}d`;
    await c.query(`insert into rum_session (session_id, app_id, last_seen_at) values ($1,$2, now() - make_interval(days=>$3))`, [sid, app, d]);
    const { rows: [{ id }] } = await c.query(
      `insert into rum_pageview (session_id, app_id, route, started_at) values ($1,$2,'/x', now() - make_interval(days=>$3)) returning id`, [sid, app, d]);
    await c.query(
      `insert into rum_metric (session_id, pageview_id, app_id, route, name, value, rating, ts)
       values ($1,$2,$3,'/x','LCP',2000,'good', now() - make_interval(days=>$4))`, [sid, id, app, d]);
  }
}

const metrics = async (c, app) => Number((await c.query("select count(*)::int n from rum_metric where app_id=$1", [app])).rows[0].n);
const sessions = async (c, app) => Number((await c.query("select count(*)::int n from rum_session where app_id=$1", [app])).rows[0].n);
const rollups = async (c, app) => Number((await c.query("select count(*)::int n from rum_rollup_hourly where app_id=$1", [app])).rows[0].n);

function assert(label, cond) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await applyAll(c);

  // app-a : rétention 7 j ; app-b : 60 j ; app-c : absente du registre → défaut 30 j
  await c.query(`insert into app_registry (app_id, name, retention_days) values ('app-a','A',7),('app-b','B',60)`);
  await seedApp(c, "app-a", [5, 10, 40]);
  await seedApp(c, "app-b", [10, 40, 90]);
  await seedApp(c, "app-c", [10, 40]);

  // peuple les rollups (1 bucket/heure ⇒ 1 ligne par metric daté) AVANT la purge
  await c.query("select refresh_rum_rollups(24 * 100)");

  await c.query("select purge_rum_tenants(30)");

  assert("app-a (7 j) : ne garde que 5 j  → 1 metric", (await metrics(c, "app-a")) === 1);
  assert("app-a : sessions purgées (10/40 j) → 1 session", (await sessions(c, "app-a")) === 1);
  assert("app-b (60 j) : garde 10 + 40 j, purge 90 j → 2 metrics", (await metrics(c, "app-b")) === 2);
  assert("app-c (défaut 30 j) : garde 10 j, purge 40 j → 1 metric", (await metrics(c, "app-c")) === 1);
  // #4 : la purge applique la rétention AUSSI aux rollups dérivés
  assert("app-a : rollups purgés selon la rétention (7 j) → 1 rollup", (await rollups(c, "app-a")) === 1);
  assert("app-b : rollups → 2 (90 j purgé)", (await rollups(c, "app-b")) === 2);

  // droit à l'effacement : tout app-b
  await c.query("select erase_app_data('app-b')");
  assert("erase_app_data(app-b) → 0 metric", (await metrics(c, "app-b")) === 0);
  assert("erase_app_data(app-b) → 0 session", (await sessions(c, "app-b")) === 0);
  assert("erase_app_data(app-b) → 0 rollup (agrégats dérivés effacés)", (await rollups(c, "app-b")) === 0);

  // effacement d'une personne concernée : la session restante d'app-c
  await c.query("select erase_session('app-c-10d')");
  assert("erase_session(app-c-10d) → app-c vidée", (await metrics(c, "app-c")) === 0 && (await sessions(c, "app-c")) === 0);

  // app_registry préservé : erase_app_data n'efface PAS l'entrée registre
  assert(
    "app_registry préservé après erase (app-a + app-b toujours là)",
    Number((await c.query("select count(*)::int n from app_registry where app_id in ('app-a','app-b')")).rows[0].n) === 2,
  );

  await c.end();
  console.log(process.exitCode ? "\n[verify-conformite] ÉCHEC." : "\n[verify-conformite] rétention par tenant + effacement VÉRIFIÉS.");
}

main().catch((e) => { console.error("[verify-conformite] échec:", e?.message ?? e); process.exit(2); });
