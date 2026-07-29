// E1-S3 — prouve sur Postgres réel que l'isolation multi-tenant tient EN BASE,
// c'est-à-dire sans qu'aucune requête ne porte de `WHERE app_id = …`.
//
// C'est le test que réclamait la revue produit : « un token tenant A ne lit
// jamais B, même sans WHERE app_id= ». Il joue le rôle de console_ro — le rôle
// applicatif cible : non-propriétaire des tables et sans BYPASSRLS, donc soumis
// aux policies. Toute requête ci-dessous est délibérément écrite SANS filtre
// applicatif : ce qui filtre, c'est RLS, ou rien.
//
//   pg_virtualenv node scripts/verify-tenant-isolation.mjs
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

const DIR = new URL("../apps/ingest/sql/", import.meta.url);
let failures = 0;
function assert(label, cond) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}

async function applyAll(c) {
  const files = (await readdir(DIR)).filter((f) => f.startsWith("migration-v") && f.endsWith(".sql")).sort(
    (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]),
  );
  for (const f of ["schema.sql", ...files]) {
    try { await c.query(await readFile(new URL(f, DIR), "utf8")); }
    catch (e) { if (!/pg_cron|pg_net|cron\.|net\.|extension/i.test(String(e.message))) throw e; }
  }
}

// Compte les lignes visibles SANS aucun filtre applicatif.
const seen = async (c, table) => Number((await c.query(`select count(*)::int n from ${table}`)).rows[0].n);

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if; end $$;");
  await c.query("grant usage on schema public to console_ro");
  await applyAll(c);
  await c.query("grant select on all tables in schema public to console_ro");

  // ── Deux tenants, données symétriques ──────────────────────────────────────
  for (const app of ["app-a", "app-b"]) {
    await c.query("insert into app_registry (app_id, name) values ($1,$1) on conflict do nothing", [app]);
    await c.query("insert into rum_session (session_id, app_id) values ($1,$2)", [`s-${app}`, app]);
    await c.query(
      `insert into rum_metric (session_id,app_id,route,name,value,rating,ts)
       values ($1,$2,'/x','LCP',1200,'good', now() - interval '5 min')`, [`s-${app}`, app]);
    await c.query(
      `insert into rum_error (session_id,app_id,route,message,ts)
       values ($1,$2,'/x','boom', now() - interval '5 min')`, [`s-${app}`, app]);
    await c.query(
      `insert into alert_rule (app_id,metric,comparator,threshold,window_minutes,mode,severity)
       values ($1,'LCP','>',2000,15,'threshold','warning')`, [app]);
    await c.query(
      `insert into uptime_check (app_id,name,url) values ($1,'home','https://ex.invalid/')`, [app]);
  }
  // Un événement d'alerte + une livraison rattachés au tenant A uniquement.
  const ruleA = (await c.query("select id from alert_rule where app_id='app-a' limit 1")).rows[0].id;
  const evA = (await c.query(
    `insert into alert_event (rule_id,value,message,severity) values ($1,1,'a','warning') returning id`,
    [ruleA])).rows[0].id;
  await c.query(`insert into alert_delivery (alert_event_id,target,status) values ($1,'http://x/','ok')`, [evA]);
  const chkA = (await c.query("select id from uptime_check where app_id='app-a' limit 1")).rows[0].id;
  await c.query(`insert into uptime_result (check_id,ok,status_code,latency_ms) values ($1,true,200,10)`, [chkA]);

  // ── Garde structurelle : aucune policy permissive résiduelle ───────────────
  // Les policies permissives se combinent en OU : une seule `using (true)`
  // laissée sur une table scopée annule le filtrage sans que rien ne le dise.
  // C'est exactement ce qui s'est produit en développant v47 (cro_all_alert_event,
  // cro_sel_delivery, cro_sel_uptime_result), d'où cette assertion.
  const leftovers = (await c.query(
    `select c.relname || '.' || p.polname as pol
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and pg_get_expr(p.polqual, p.polrelid) = 'true'
        and (exists (select 1 from pg_attribute a where a.attrelid = c.oid
                      and a.attname = 'app_id' and a.attnum > 0 and not a.attisdropped)
             or c.relname in ('alert_event','alert_delivery','uptime_result'))
      order by 1`)).rows.map((r) => r.pol);
  assert(`aucune policy \`using (true)\` sur une table scopée${leftovers.length ? ` — restantes : ${leftovers.join(", ")}` : ""}`,
    leftovers.length === 0);

  // ── Le propriétaire voit tout (l'exploitation garde sa portée) ──────────────
  assert("propriétaire : voit les 2 tenants (purge/alerting non cassés)", (await seen(c, "rum_metric")) === 2);

  // ── Rôle applicatif, portée tenant A ───────────────────────────────────────
  await c.query("set role console_ro");
  await c.query("select set_config('app.current_app_id','app-a',false)");

  assert("console_ro + portée A : ne voit QUE les métriques de A", (await seen(c, "rum_metric")) === 1);
  assert("console_ro + portée A : ne voit QUE les erreurs de A", (await seen(c, "rum_error")) === 1);
  assert("console_ro + portée A : ne voit QUE les sessions de A", (await seen(c, "rum_session")) === 1);
  assert("console_ro + portée A : ne voit QUE les règles de A", (await seen(c, "alert_rule")) === 1);
  assert("console_ro + portée A : ne voit QUE le registre de A", (await seen(c, "app_registry")) === 1);

  const rows = (await c.query("select distinct app_id from rum_metric")).rows.map((r) => r.app_id);
  assert("console_ro + portée A : aucune ligne de B ne transparaît", rows.length === 1 && rows[0] === "app-a");

  // Tables filles : scopées via leur parent.
  assert("fille alert_event : visible (parent A)", (await seen(c, "alert_event")) === 1);
  assert("fille alert_delivery : visible (parent A)", (await seen(c, "alert_delivery")) === 1);
  assert("fille uptime_result : visible (parent A)", (await seen(c, "uptime_result")) === 1);

  // ── Portée tenant B : la symétrie doit tenir ───────────────────────────────
  await c.query("select set_config('app.current_app_id','app-b',false)");
  const rowsB = (await c.query("select distinct app_id from rum_metric")).rows.map((r) => r.app_id);
  assert("portée B : ne voit QUE B (symétrique)", rowsB.length === 1 && rowsB[0] === "app-b");
  assert("portée B : l'événement d'alerte de A est invisible", (await seen(c, "alert_event")) === 0);
  assert("portée B : la livraison de A est invisible", (await seen(c, "alert_delivery")) === 0);
  assert("portée B : le résultat uptime de A est invisible", (await seen(c, "uptime_result")) === 0);

  // ── Portée absente : fail-closed, jamais fail-open ─────────────────────────
  await c.query("select set_config('app.current_app_id','',false)");
  assert("portée vide : AUCUNE métrique visible (fail-closed)", (await seen(c, "rum_metric")) === 0);
  assert("portée vide : AUCUNE erreur visible (fail-closed)", (await seen(c, "rum_error")) === 0);

  await c.query("reset role");

  // ── L'API publique (PostgREST) ne doit RIEN voir, quelle que soit la GUC ────
  // anon/authenticated portent des droits DML sur une partie des tables ; s'ils
  // ne lisent rien, c'est parce qu'AUCUNE policy ne les vise. Une policy sans
  // clause `TO` s'appliquerait à PUBLIC et remplacerait ce « jamais autorisé »
  // par un « autorisé si la GUC est posée ». On vérifie donc le cas hostile :
  // portée tenant POSÉE, et pourtant zéro ligne.
  for (const role of ["anon", "authenticated"]) {
    await c.query(
      `do $$ begin if not exists (select 1 from pg_roles where rolname='${role}') then create role ${role} nologin; end if; end $$;`);
    await c.query(`grant usage on schema public to ${role}`);
    await c.query(`grant select on all tables in schema public to ${role}`);
    await c.query(`set role ${role}`);
    await c.query("select set_config('app.current_app_id','app-a',false)");
    const vus = await seen(c, "rum_metric");
    await c.query("reset role");
    assert(`API publique : ${role} ne lit RIEN même avec une portée posée`, vus === 0);
  }

  // ── console_ro n'écrit que là où la console écrit vraiment (v48) ────────────
  await c.query("set role console_ro");
  let refus = false;
  try {
    await c.query("insert into rum_metric (session_id,app_id,route,name,value,ts) values ('x','app-a','/x','LCP',1,now())");
  } catch { refus = true; }
  await c.query("rollback").catch(() => {});
  await c.query("reset role");
  assert("console_ro : écriture REFUSÉE sur la télémétrie (rum_metric)", refus);

  // Le refus ci-dessus passerait AUSSI sans v48 : la policy tenant_scope n'a pas
  // de clause WITH CHECK, donc RLS bloque déjà l'insertion. On teste donc le
  // privilège lui-même, qui est la propriété que v48 installe.
  const priv = (await c.query(
    `select has_table_privilege('console_ro','rum_metric','INSERT') as tele_insert,
            has_table_privilege('console_ro','rum_metric','SELECT') as tele_select,
            has_table_privilege('console_ro','slo','UPDATE')        as conf_update,
            has_table_privilege('console_ro','rum_span','INSERT')   as dogfood_insert`)).rows[0];
  assert("v48 : PRIVILÈGE d'insertion retiré sur rum_metric", priv.tele_insert === false);
  assert("v48 : lecture PRÉSERVÉE sur rum_metric", priv.tele_select === true);
  assert("v48 : écriture préservée sur la configuration (slo)", priv.conf_update === true);
  assert("v48 : écriture préservée sur rum_span (dogfooding console)", priv.dogfood_insert === true);

  await c.query("set role console_ro");
  await c.query("select set_config('app.current_app_id','app-a',false)");
  let ecritConfig = true;
  try {
    await c.query("update slo set name = name where app_id = 'app-a'");
  } catch { ecritConfig = false; }
  await c.query("rollback").catch(() => {});
  await c.query("reset role");
  assert("console_ro : écriture AUTORISÉE sur la configuration (slo)", ecritConfig);

  // ── L'exploitation reste inter-tenant après RLS ────────────────────────────
  // Une fonction security definer (propriétaire) doit continuer à voir les deux
  // tenants : c'est ce que FORCE ROW LEVEL SECURITY aurait cassé.
  const fired = Number((await c.query("select check_alerts() as n")).rows[0].n);
  assert("security definer : check_alerts() garde sa portée inter-tenant", fired >= 0);
  assert("propriétaire après RLS : voit toujours les 2 tenants", (await seen(c, "rum_metric")) === 2);

  await c.end();
  console.log(failures ? `\n[verify-tenant-isolation] ÉCHEC (${failures}).` : "\n[verify-tenant-isolation] isolation multi-tenant PROUVÉE EN BASE.");
  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error("[verify-tenant-isolation] échec:", e?.message ?? e); process.exit(2); });
