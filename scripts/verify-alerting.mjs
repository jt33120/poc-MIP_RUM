// P1 — alerting mature : prouve sur Postgres réel les 3 piliers de migration-v17.
//   1. baselines : une règle 'baseline' alerte sur l'anomalie saisonnière, pas un
//      seuil fixe (et NE déclenche PAS sur une valeur normale) ; 'threshold' intact.
//   2. SLO : slo_status() calcule l'atteinte/budget ; check_slo_burn() déclenche
//      sur burn rapide (alert_event rattaché au SLO).
//   3. routing : route_alert() sélectionne les canaux par sévérité ; lecture console_ro.
//   pg_virtualenv node scripts/verify-alerting.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../packages/db/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...[
  "02","03","04","05","07","08","09","10","11","12","13","14","15","16","17",
  "20","29","45","46","49","50","58","62","65","66","68",
].map((n) => `migration-v${n}.sql`)];

async function applyAll(c) {
  for (const f of MIGR) {
    // v62/v65 consume the fail-closed helper introduced by v47. This focused
    // verifier intentionally does not replay the full tenant-isolation stack,
    // so install the same helper before creating rum_event_index.
    if (f === "migration-v62.sql") {
      await c.query(`create or replace function current_app_ids() returns text[] language sql stable as $$
        select case when nullif(current_setting('app.current_app_ids', true), '') is null
          then array[]::text[] else string_to_array(current_setting('app.current_app_ids', true), ',') end
      $$`);
    }
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

  // ── P4 : événements custom, threshold + baseline zero-filled ─────────────
  await c.query("insert into app_registry (app_id, name) values ('app-b','B') on conflict do nothing");
  await c.query("insert into rum_session (session_id, app_id) values ('s2','app-b') on conflict do nothing");
  await c.query("update rum_session set sample_rate=0.5 where session_id='s1' and app_id='app-a'");
  await c.query(`with ins as (
                   insert into rum_event (span_id,session_id,app_id,route,name,props,ts)
                   values ('0000000000006801','s1','app-a','/checkout','checkout','{"plan":"pro"}',now()-interval '2 min'),
                          ('0000000000006802','s1','app-a','/checkout','checkout','{"plan":"pro"}',now()-interval '1 min')
                   returning span_id,session_id,app_id,route,name,ts
                 )
                 insert into rum_event_index (app_id,session_id,ts,route,kind,source_span_id)
                 select app_id,session_id,ts,route,'event',span_id from ins`);
  await c.query(`with ins as (
                   insert into rum_event (span_id,session_id,app_id,route,name,props,ts)
                   select lpad(to_hex(50000+g),16,'0'),'s2','app-b','/checkout','checkout','{}',now()-interval '1 min'
                     from generate_series(1,20) g
                   returning span_id,session_id,app_id,route,ts
                 )
                 insert into rum_event_index (app_id,session_id,ts,route,kind,source_span_id)
                 select app_id,session_id,ts,route,'event',span_id from ins`);
  await c.query(`insert into alert_rule (app_id,metric,comparator,threshold,window_minutes,mode,severity)
                 values ('app-a','event:checkout','>',1,15,'threshold','warning')`);
  assert("event threshold : compte uniquement l'app de la règle", (await fire(c)) >= 1);
  const eventValue = Number((await c.query(`select ae.value from alert_event ae join alert_rule r on r.id=ae.rule_id
                                             where r.metric='event:checkout' order by ae.id desc limit 1`)).rows[0]?.value);
  assert("event threshold : valeur observée app-a = 2 (aucune fuite app-b)", eventValue === 2);
  const eventMessage = String((await c.query(`select ae.message from alert_event ae join alert_rule r on r.id=ae.rule_id
                                               where r.metric='event:checkout' order by ae.id desc limit 1`)).rows[0]?.message ?? "");
  assert("event threshold : message signale le sampling sans extrapoler", /échantillon/.test(eventMessage) && /sans extrapolation/.test(eventMessage));

  // 20 événements existent dans l'heure historique mais HORS de la fenêtre
  // de 30 min. Une baseline figée à l'heure compterait 20 ; la baseline alignée
  // sur la règle voit cinq zéros (MAD=0) et doit détecter le pic courant.
  for (const w of [1, 2, 3, 4, 5]) {
    await c.query(`with ins as (
                     insert into rum_event (span_id,session_id,app_id,route,name,props,ts)
                     select lpad(to_hex(30000+$1*100+g),16,'0'),'s1','app-a','/signup','signup','{}',
                            now() - make_interval(weeks => $1) - interval '45 min'
                       from generate_series(1,20) g
                     returning span_id,session_id,app_id,route,ts
                   )
                   insert into rum_event_index (app_id,session_id,ts,route,kind,source_span_id)
                   select app_id,session_id,ts,route,'event',span_id from ins`, [w]);
  }
  await c.query(`with ins as (
                   insert into rum_event (span_id,session_id,app_id,route,name,props,ts)
                   select lpad(to_hex(40000+g),16,'0'),'s1','app-a','/signup','signup','{}',now()-interval '1 min'
                     from generate_series(1,10) g
                   returning span_id,session_id,app_id,route,ts
                 )
                 insert into rum_event_index (app_id,session_id,ts,route,kind,source_span_id)
                 select app_id,session_id,ts,route,'event',span_id from ins`);
  await c.query(`insert into alert_rule (app_id,metric,route,comparator,threshold,window_minutes,mode,sensitivity,baseline_weeks,severity)
                 values ('app-a','event:signup','/signup','>',999999,30,'baseline',3,5,'critical')`);
  assert("event baseline : fenêtre 30 min, zéros et MAD=0 déclenchent sur le pic", (await fire(c)) >= 1);

  const eventIndex = await c.query(`select indexname from pg_indexes where indexname in
    ('idx_rum_event_explorer_v68','idx_rum_event_props_v68','idx_event_context_v66')`);
  assert("v68 : index explorer/props + GIN context v66 présents", eventIndex.rowCount === 3);

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

  // ── Pilier 2 bis : l'objectif est une FRACTION, et fast_burn le prouve ─────
  // Régression migration-v46. `objective` en pourcent (99 au lieu de 0,99) rendait
  // le budget négatif, donc `(1 - atteinte) >= 14,4 × budget` toujours vrai : le
  // SLO se déclarait « en burn » en permanence (627 fausses alertes en prod).
  const rejected = await c.query(
    `insert into slo (app_id,name,metric,objective,window_days) values ('app-a','pourcent','LCP',99,28)`,
  ).then(() => null, (e) => e);
  assert("slo : un objectif en pourcent (99) est REFUSÉ à l'écriture",
    rejected !== null && /slo_objective_is_ratio/.test(String(rejected.message)));

  // Défense en profondeur : même contrainte retirée, un budget non positif ne
  // doit plus produire un burn permanent.
  await c.query("alter table slo drop constraint slo_objective_is_ratio");
  const badId = (await c.query(
    `insert into slo (app_id,name,metric,objective,window_days)
     values ('app-a','pourcent','LCP',99,28) returning id`)).rows[0].id;
  const bad = (await c.query("select * from slo_status('app-a') where slo_id=$1", [badId])).rows[0];
  assert("slo_status : budget non positif -> fast_burn false (anti-tautologie)", bad?.fast_burn === false);
  assert("slo_status : budget non positif -> burned_pct null", bad?.burned_pct === null);
  await c.query("delete from slo where id=$1", [badId]);
  await c.query("alter table slo add constraint slo_objective_is_ratio check (objective > 0 and objective < 1)");

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

  // ── Pilier 4 : la boucle se ferme réellement (migration-v49) ───────────────
  // Sans pg_net (cas local/CI), une ligne routée doit RESTER `queued` : c'est le
  // contrat avec dispatch-alerts.mjs, qui traite `queued` immédiatement mais
  // `failed` seulement après un délai de reprise. Marquer `failed` ce qui n'a
  // jamais été tenté retarderait la livraison locale.
  const statutsWeb = (await c.query(
    "select distinct status from alert_delivery where alert_event_id=$1", [ev])).rows.map((r) => r.status);
  assert("sans pg_net : la livraison reste 'queued' (contrat du dispatcher local)",
    statutsWeb.length === 1 && statutsWeb[0] === "queued");

  // Un canal e-mail (compté ci-dessous par console_ro). Son routage ne se juge
  // plus ici : ce script rejoue les migrations jusqu'à v68, et depuis v88
  // `route_alert` laisse la ligne `queued` pour le notifier, qui l'envoie par
  // Resend ou la solde `skipped` avec sa raison. Cette chaîne est vérifiée sur le
  // schéma COMPLET par tests/integration/livraison-v88-sql.test.ts.
  await c.query(`insert into notify_channel (app_id, kind, target, severity_min)
                 values ('app-a','email','ops@example.com','warning')`);

  // Réconciliation : une livraison 'sent' sans réponse depuis plus d'une heure
  // est un ÉCHEC, pas un suspens. C'est le cœur du correctif : « sent » ne peut
  // pas rester un statut terminal.
  const ev3 = (await c.query(`insert into alert_event (rule_id, value, message, severity)
                              values (null, 1, 'test recon', 'warning') returning id`)).rows[0].id;
  await c.query(`insert into alert_delivery (alert_event_id, target, status, request_id, attempted_at)
                 values ($1,'http://hook.local/old','sent', 999999, now() - interval '2 hours')`, [ev3]);
  const recon = Number((await c.query("select reconcile_alert_deliveries() n")).rows[0].n);
  const vieille = (await c.query(
    "select status, response from alert_delivery where alert_event_id=$1", [ev3])).rows[0];
  assert("réconciliation : 'sent' sans réponse après 1 h devient 'failed'", vieille?.status === "failed");
  assert("réconciliation : la raison est explicite", /aucune réponse HTTP/i.test(vieille?.response ?? ""));
  assert("réconciliation : sans pg_net, ne casse pas (retourne un entier)", Number.isInteger(recon));

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
    cro.slo > 0 && cro.ch === 3 && cro.rule >= 2 && cro.ev >= 1); // 3 canaux : warn, crit, email

  await c.end();
  console.log(process.exitCode ? "\n[verify-alerting] ÉCHEC." : "\n[verify-alerting] alerting mature (3 piliers) VÉRIFIÉ.");
}
main().catch((e) => { console.error("[verify-alerting] échec:", e?.message ?? e); process.exit(2); });
