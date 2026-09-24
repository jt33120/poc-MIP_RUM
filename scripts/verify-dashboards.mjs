// P1 — tableaux de bord : prouve sur Postgres réel le CRUD dashboard, la lecture/
// écriture sous console_ro (policy v18), et l'effacement RGPD (un dashboard scopé à
// une app part avec erase_app_data, un dashboard non scopé est préservé).
//   pg_virtualenv node scripts/verify-dashboards.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../packages/db/sql/${f}`, import.meta.url);
// v17 (alerting) vit sur une autre branche : on applique 02..16 + 18 (v18 indépendante).
const MIGR = ["schema.sql", ...["02","03","04","05","07","08","09","10","11","12","13","14","15","16","18"].map((n) => `migration-v${n}.sql`)];

async function applyAll(c) {
  for (const f of MIGR) {
    try { await c.query(await readFile(SQL(f), "utf8")); }
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
  await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if; end $$;");
  await c.query("grant usage on schema public to console_ro");
  await applyAll(c);

  // CRUD (propriétaire)
  const layout = JSON.stringify([
    { type: "vital_p75", title: "LCP p75", metric: "LCP" },
    { type: "traffic", title: "Trafic" },
  ]);
  const id = (await c.query(
    `insert into dashboard (name, app_id, layout, created_by) values ('COPIL','app-a',$1::jsonb,'admin@mip') returning id`,
    [layout],
  )).rows[0].id;
  const got = (await c.query("select name, app_id, jsonb_array_length(layout) as n from dashboard where id=$1", [id])).rows[0];
  assert("dashboard créé (2 widgets)", got.name === "COPIL" && Number(got.n) === 2);

  await c.query("update dashboard set layout = layout || '[{\"type\":\"frustration\",\"title\":\"Frustration\"}]'::jsonb, updated_at=now() where id=$1", [id]);
  assert("layout mis à jour (3 widgets)",
    Number((await c.query("select jsonb_array_length(layout) n from dashboard where id=$1", [id])).rows[0].n) === 3);

  // un dashboard NON scopé (app_id null)
  await c.query("insert into dashboard (name, app_id, layout) values ('Global', null, '[]'::jsonb)");

  // RLS active + lecture/écriture sous console_ro
  assert("RLS active sur dashboard",
    (await c.query("select relrowsecurity from pg_class where relname='dashboard'")).rows[0].relrowsecurity === true);
  await c.query("set role console_ro");
  const croN = Number((await c.query("select count(*) n from dashboard")).rows[0].n);
  let wrote = true;
  try { await c.query("update dashboard set name='COPIL Q3' where id=$1", [id]); } catch { wrote = false; }
  await c.query("reset role");
  assert("console_ro LIT les dashboards (≠0)", croN === 2);
  assert("console_ro ÉCRIT (update) un dashboard", wrote &&
    (await c.query("select name from dashboard where id=$1", [id])).rows[0].name === "COPIL Q3");

  // Effacement RGPD : app-a part, le dashboard global (app_id null) reste
  await c.query("select erase_app_data('app-a')");
  assert("erase_app_data(app-a) supprime le dashboard scopé",
    Number((await c.query("select count(*) n from dashboard where app_id='app-a'")).rows[0].n) === 0);
  assert("dashboard non scopé (global) préservé",
    Number((await c.query("select count(*) n from dashboard where app_id is null")).rows[0].n) === 1);

  await c.end();
  console.log(process.exitCode ? "\n[verify-dashboards] ÉCHEC." : "\n[verify-dashboards] dashboards (CRUD + console_ro + RGPD) VÉRIFIÉ.");
}
main().catch((e) => { console.error("[verify-dashboards] échec:", e?.message ?? e); process.exit(2); });
