// P1 — alerting mature : prouve sur Postgres réel les 3 piliers de migration-v17.
//   1. baselines : une règle 'baseline' alerte sur l'anomalie saisonnière, pas un
//      seuil fixe (et NE déclenche PAS sur une valeur normale) ; 'threshold' intact.
//   2. SLO : slo_status() calcule l'atteinte/budget ; check_slo_burn() déclenche
//      sur burn rapide (alert_event rattaché au SLO).
//   3. routing : route_alert() sélectionne les canaux par sévérité ; lecture console_ro.
//   pg_virtualenv node scripts/verify-alerting.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../apps/ingest/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...["02","03","04","05","07","08","09","10","11","12","13","14","15","16","17"].map((n) => `migration-v${n}.sql`)];

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
const fire = async (c) => Number((await c.query("select check_alerts() as n")).rows[0].n);

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if; end $$;");
  await c.query("grant usage on schema public to console_ro");
  await applyAll(c);
  await c.query("insert into app_registry (app_id, name) values ('app-a','A') on conflict do nothing");
  await c.query("insert into rum_session (session_id, app_id) values ('s1','app-a')");
  const m = (value, when) =>
    c.query(`insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
             values ('s1','app-a','/x','LCP',$1,$2, ${when})`, [value, value <= 2000 ? "good" : "poor"]);

  // ── Pilier 1 : THRESHOLD (rétro-compat) ────────────────────────────────────
  await m(5000, "now() - interval '2 min'"); // courant élevé
  await c.query(`insert into alert_rule (app_id, metric, comparator, threshold, window_minutes, mode, severity)
                 values ('app-a','LCP','>',2000,15,'threshold','warning')`);
  assert("threshold : règle classique déclenche", (await fire(c)) >= 1);

  // ── Pilier 1 : BASELINE (anomalie saisonnière) ─────────────────────────────
  // historique sur la route /base, au MÊME créneau saisonnier (dow+heure : pile
  // now()-w semaines) sur 5 semaines, ~2000 ms avec dispersion (MAD>0).
  for (const [w, val] of [[1,1900],[2,2100],[3,2000],[4,2050],[5,1950]])
    await c.query(`insert into rum_metric (session_id,app_id,route,name,value,rating,ts)
                   values ('s1','app-a','/base','LCP',$1,'good', now() - interval '${w} weeks')`, [val]);
  await c.query(`insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, mode, sensitivity, baseline_weeks, severity)
                 values ('app-a','LCP','/base','>',999999,30,'baseline',3,5,'critical')`);
  // valeur courante NORMALE (~2000) sur la route /base -> pas d'anomalie
  await c.query(`insert into rum_metric (session_id,app_id,route,name,value,rating,ts)
                 values ('s1','app-a','/base','LCP',2000,'good', now() - interval '2 min')`);
  const firedNormal = await fire(c);
  assert("baseline : valeur normale ne déclenche PAS", firedNormal === 0);
  // pic d'anomalie (~6000) très au-dessus du normal saisonnier
  await c.query(`insert into rum_metric (session_id,app_id,route,name,value,rating,ts)
                 values ('s1','app-a','/base','LCP',6000,'poor', now() - interval '1 min')`);
  assert("baseline : pic anormal déclenche", (await fire(c)) >= 1);
  const bmsg = (await c.query(`select message from alert_event ae join alert_rule r on r.id=ae.rule_id
                               where r.mode='baseline' order by ae.id desc limit 1`)).rows[0]?.message ?? "";
  assert("baseline : message mentionne le normal (≈)", /normal≈/.test(bmsg));

  // ── Pilier 2 : SLO + burn ──────────────────────────────────────────────────
  // SLO LCP 99% / 28 j. Dernière heure dégradée (20% poor) -> fast burn.
  await c.query(`insert into slo (app_id, name, metric, objective, window_days) values ('app-a','LCP 99','LCP',0.99,28)`);
  for (let i=0;i<16;i++) await m(1500, "now() - interval '10 min'"); // good récents
  for (let i=0;i<4;i++)  await m(6000, "now() - interval '10 min'"); // 4/20 = 20% poor (>14,4% budget)
  const st = (await c.query("select * from slo_status('app-a')")).rows[0];
  assert("slo_status : atteinte calculée (0<att≤1)", st && st.attainment > 0 && st.attainment <= 1);
  assert("slo_status : fast_burn détecté (1h dégradée)", st && st.fast_burn === true);
  const burned = await c.query("select check_slo_burn() as n");
  assert("check_slo_burn : déclenche un alert_event SLO", Number(burned.rows[0].n) >= 1);
  assert("alert_event SLO rattaché au slo_id (rule_id null)",
    Number((await c.query("select count(*)::int n from alert_event where slo_id is not null and rule_id is null")).rows[0].n) >= 1);

  // ── Pilier 3 : routing par sévérité ────────────────────────────────────────
  await c.query(`insert into notify_channel (app_id, kind, target, severity_min) values
                 ('app-a','webhook','http://hook.local/warn','warning'),
                 ('app-a','webhook','http://hook.local/crit','critical')`);
  // un event 'warning' route vers le canal warning, PAS le canal critical
  const ev = (await c.query(`insert into alert_event (rule_id, value, message, severity)
                             values (null, 1, 'test routing', 'warning') returning id`)).rows[0].id;
  await c.query("select route_alert($1,'app-a','warning','[t] test', '{}'::jsonb)", [ev]);
  const targets = (await c.query("select target from alert_delivery where alert_event_id=$1 order by target", [ev])).rows.map((r) => r.target);
  assert("routing : canal 'warning' notifié", targets.includes("http://hook.local/warn"));
  assert("routing : canal 'critical' PAS notifié pour un warning", !targets.includes("http://hook.local/crit"));

  // ── console_ro lit les nouvelles tables (parité) ───────────────────────────
  await c.query("set role console_ro");
  const cro = {
    slo: Number((await c.query("select count(*) n from slo")).rows[0].n),
    ch: Number((await c.query("select count(*) n from notify_channel")).rows[0].n),
    rule: Number((await c.query("select count(*) n from alert_rule")).rows[0].n),
    ev: Number((await c.query("select count(*) n from alert_event")).rows[0].n),
  };
  await c.query("reset role");
  assert("console_ro LIT slo / notify_channel / alert_rule / alert_event",
    cro.slo > 0 && cro.ch === 2 && cro.rule >= 2 && cro.ev >= 1);

  await c.end();
  console.log(process.exitCode ? "\n[verify-alerting] ÉCHEC." : "\n[verify-alerting] alerting mature (3 piliers) VÉRIFIÉ.");
}
main().catch((e) => { console.error("[verify-alerting] échec:", e?.message ?? e); process.exit(2); });
