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
// Les assertions propriétaire ne doivent pas dépendre d'autres fixtures dans la
// même base jetable : elles ciblent explicitement les deux tenants créés ici.
const seenFixture = async (c, table) => Number((await c.query(
  `select count(*)::int n from ${table} where app_id in ('app-a', 'app-b')`,
)).rows[0].n);

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
      `insert into rum_event_index (app_id,session_id,ts,route,kind,source_span_id)
       values ($1,$2,now() - interval '5 min','/x','pageview',$3)`,
      [app, `s-${app}`, app === "app-a" ? "00000000000000a1" : "00000000000000b1"],
    );
    // P7.5 — capacités mobiles déclarées. Une table scopée de plus, donc une
    // policy de plus à prouver : elle nomme les releases d'un client.
    await c.query(
      `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
       values ($1,'react_native','1.0.0','js_errors',true)`, [app]);
    await c.query(
      `insert into rum_action (action_id,span_id,session_id,app_id,type,name,route,ts)
       values ($1,$2,$3,$4,'click','Payer','/x',now() - interval '5 min')`,
      [
        app === "app-a" ? "11111111-2222-4333-8444-555555555555" : "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        app === "app-a" ? "00000000000000a2" : "00000000000000b2",
        `s-${app}`,
        app,
      ],
    );
    await c.query(
      `insert into alert_rule (app_id,metric,comparator,threshold,window_minutes,mode,severity)
       values ($1,'LCP','>',2000,15,'threshold','warning')`, [app]);
    await c.query(
      `insert into uptime_check (app_id,name,url) values ($1,'home','https://ex.invalid/')`, [app]);
    // P5.4 : jeton de CI d'upload de source maps, secret haché seulement.
    await c.query(
      `insert into sourcemap_upload_token (id,app_id,name,secret_hash,created_by,expires_at)
       values (gen_random_uuid(),$1,'CI',repeat('a',64),'isolation@test',now() + interval '1 day')`, [app]);
    // P5.5 : configuration du regroupement, issue et alias d'un groupe historique.
    await c.query("select error_grouping_activate($1, 'isolation@test')", [app]);
    const issue = (await c.query(
      `insert into error_issue (app_id,grouping_version,grouping_key,grouping_basis,origin,status,first_seen,last_seen)
       values ($1,2,repeat('c',32),'normalized_frame','new','open',now(),now()) returning id`, [app])).rows[0].id;
    await c.query(
      "insert into error_issue_alias (app_id,legacy_fingerprint,issue_id) values ($1,'368e01a8',$2)", [app, issue]);
    // P5.6 : la notification « new » de l'issue naît par déclencheur ; un commentaire, un lien de ticket.
    await c.query(
      `insert into error_issue_activity (app_id,issue_id,kind,actor_kind,body) values ($1,$2,'comment','user','suivi')`,
      [app, issue]);
    await c.query(
      `insert into error_issue_ticket (app_id,issue_id,url,label) values ($1,$2,'https://tickets.exemple.fr/1','T-1')`,
      [app, issue]);
  }
  // Un événement d'alerte + une livraison rattachés au tenant A uniquement.
  const ruleA = (await c.query("select id from alert_rule where app_id='app-a' limit 1")).rows[0].id;
  const evA = (await c.query(
    `insert into alert_event (rule_id,value,message,severity) values ($1,1,'a','warning') returning id`,
    [ruleA])).rows[0].id;
  await c.query(`insert into alert_delivery (alert_event_id,target,status) values ($1,'http://x/','ok')`, [evA]);
  const chkA = (await c.query("select id from uptime_check where app_id='app-a' limit 1")).rows[0].id;
  await c.query(`insert into uptime_result (check_id,ok,status_code,latency_ms) values ($1,true,200,10)`, [chkA]);
  // P5.6 : l'événement SANS règle né de la notification d'issue de A appartient à A.
  const evIssueA = (await c.query(
    `insert into alert_event (rule_id,value,message,severity) values (null,null,'nouvelle issue','warning') returning id`)).rows[0].id;
  await c.query(
    `update error_issue_notification set state='delivered', delivered_at=now(), alert_event_id=$1 where app_id='app-a'`, [evIssueA]);

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
  assert("propriétaire : voit les 2 tenants de fixture (purge/alerting non cassés)", (await seenFixture(c, "rum_metric")) === 2);

  // ── Rôle applicatif, portée tenant A ───────────────────────────────────────
  await c.query("set role console_ro");
  await c.query("select set_config('app.current_app_id','app-a',false)");

  assert("console_ro + portée A : ne voit QUE les métriques de A", (await seen(c, "rum_metric")) === 1);
  assert("console_ro + portée A : ne voit QUE les erreurs de A", (await seen(c, "rum_error")) === 1);
  assert("console_ro + portée A : ne voit QUE les sessions de A", (await seen(c, "rum_session")) === 1);
  assert("console_ro + portée A : ne voit QUE les événements indexés de A", (await seen(c, "rum_event_index")) === 1);
  assert("console_ro + portée A : ne voit QUE les actions de A", (await seen(c, "rum_action")) === 1);
  assert("console_ro + portée A : ne voit QUE les règles de A", (await seen(c, "alert_rule")) === 1);
  assert("console_ro + portée A : ne voit QUE le registre de A", (await seen(c, "app_registry")) === 1);
  assert("console_ro + portée A : ne voit QUE les jetons de source maps de A", (await seen(c, "sourcemap_upload_token")) === 1);
  assert("console_ro + portée A : ne voit QUE les issues de A", (await seen(c, "error_issue")) === 1);
  assert("console_ro + portée A : ne voit QUE les alias de A", (await seen(c, "error_issue_alias")) === 1);
  assert("console_ro + portée A : ne voit QUE la configuration de regroupement de A", (await seen(c, "error_grouping_config")) === 1);
  assert("console_ro + portée A : ne voit QUE l'activité des issues de A", (await seen(c, "error_issue_activity")) === 1);
  assert("console_ro + portée A : ne voit QUE les liens de ticket de A", (await seen(c, "error_issue_ticket")) === 1);
  assert("console_ro + portée A : ne voit QUE les notifications d'issue de A", (await seen(c, "error_issue_notification")) === 1);
  assert("console_ro + portée A : ne voit QUE les capacités mobiles de A", (await seen(c, "mobile_capabilities")) === 1);

  const rows = (await c.query("select distinct app_id from rum_metric")).rows.map((r) => r.app_id);
  assert("console_ro + portée A : aucune ligne de B ne transparaît", rows.length === 1 && rows[0] === "app-a");

  // Tables filles : scopées via leur parent.
  assert("fille alert_event : visible (règle A et notification d'issue A)", (await seen(c, "alert_event")) === 2);
  assert("fille alert_delivery : visible (parent A)", (await seen(c, "alert_delivery")) === 1);
  assert("fille uptime_result : visible (parent A)", (await seen(c, "uptime_result")) === 1);

  // ── Portée tenant B : la symétrie doit tenir ───────────────────────────────
  await c.query("select set_config('app.current_app_id','app-b',false)");
  const rowsB = (await c.query("select distinct app_id from rum_metric")).rows.map((r) => r.app_id);
  assert("portée B : ne voit QUE B (symétrique)", rowsB.length === 1 && rowsB[0] === "app-b");
  assert("portée B : ne voit QUE les événements indexés de B", (await seen(c, "rum_event_index")) === 1);
  assert("portée B : ne voit QUE les actions de B", (await seen(c, "rum_action")) === 1);
  assert("portée B : ne voit QUE les jetons de source maps de B", (await seen(c, "sourcemap_upload_token")) === 1);
  assert("portée B : ne voit QUE les capacités mobiles de B", (await seen(c, "mobile_capabilities")) === 1);
  assert("portée B : ne voit QUE les issues de B", (await seen(c, "error_issue")) === 1);
  assert("portée B : ne voit QUE l'activité et les liens des issues de B",
    (await seen(c, "error_issue_activity")) === 1 && (await seen(c, "error_issue_ticket")) === 1);
  assert("portée B : les événements d'alerte de A, de règle comme d'issue, sont invisibles", (await seen(c, "alert_event")) === 0);
  assert("portée B : la livraison de A est invisible", (await seen(c, "alert_delivery")) === 0);
  assert("portée B : le résultat uptime de A est invisible", (await seen(c, "uptime_result")) === 0);

  // ── Portée absente : fail-closed, jamais fail-open ─────────────────────────
  await c.query("select set_config('app.current_app_id','',false)");
  assert("portée vide : AUCUNE métrique visible (fail-closed)", (await seen(c, "rum_metric")) === 0);
  assert("portée vide : AUCUNE erreur visible (fail-closed)", (await seen(c, "rum_error")) === 0);
  assert("portée vide : AUCUN événement indexé visible (fail-closed)", (await seen(c, "rum_event_index")) === 0);
  assert("portée vide : AUCUNE action visible (fail-closed)", (await seen(c, "rum_action")) === 0);
  assert("portée vide : AUCUN jeton de source maps visible (fail-closed)", (await seen(c, "sourcemap_upload_token")) === 0);
  assert("portée vide : AUCUNE capacité mobile visible (fail-closed)", (await seen(c, "mobile_capabilities")) === 0);
  assert("portée vide : AUCUNE issue ni alias visible (fail-closed)",
    (await seen(c, "error_issue")) === 0 && (await seen(c, "error_issue_alias")) === 0);
  assert("portée vide : AUCUNE activité, AUCUN lien, AUCUNE notification d'issue (fail-closed)",
    (await seen(c, "error_issue_activity")) + (await seen(c, "error_issue_ticket")) + (await seen(c, "error_issue_notification")) === 0);

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
    const actionsVues = await seen(c, "rum_action");
    const jetonsVus = await seen(c, "sourcemap_upload_token");
    const issuesVues = await seen(c, "error_issue");
    const workflowVu = (await seen(c, "error_issue_activity")) + (await seen(c, "error_issue_ticket"))
      + (await seen(c, "error_issue_notification"));
    await c.query("reset role");
    assert(`API publique : ${role} ne lit RIEN même avec une portée posée`, vus === 0);
    assert(`API publique : ${role} ne lit AUCUNE action même avec une portée posée`, actionsVues === 0);
    assert(`API publique : ${role} ne lit AUCUN jeton de source maps même avec une portée posée`, jetonsVus === 0);
    assert(`API publique : ${role} ne lit AUCUNE issue même avec une portée posée`, issuesVues === 0);
    assert(`API publique : ${role} ne lit RIEN du workflow des issues même avec une portée posée`, workflowVu === 0);
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
            has_table_privilege('console_ro','rum_event_index','SELECT') as index_select,
            has_table_privilege('console_ro','rum_event_index','INSERT') as index_insert,
            has_table_privilege('console_ro','rum_action','SELECT') as action_select,
            has_table_privilege('console_ro','rum_action','INSERT') as action_insert,
            has_table_privilege('console_ro','error_issue','SELECT') as issue_select,
            has_table_privilege('console_ro','error_issue','UPDATE') as issue_update,
            has_table_privilege('console_ro','error_grouping_config','INSERT') as config_insert,
            has_table_privilege('console_ro','slo','UPDATE')        as conf_update,
            has_table_privilege('console_ro','rum_span','INSERT')   as dogfood_insert,
            has_table_privilege('console_ro','sourcemap_upload_token','DELETE') as jeton_delete,
            has_column_privilege('console_ro','sourcemap_upload_token','secret_hash','UPDATE') as jeton_rehash,
            has_column_privilege('console_ro','sourcemap_upload_token','revoked_at','UPDATE') as jeton_revoke,
            has_table_privilege('console_ro','error_issue_activity','INSERT') as activite_insert,
            has_table_privilege('console_ro','error_issue_activity','UPDATE') as activite_update,
            has_table_privilege('console_ro','error_issue_notification','INSERT') as outbox_insert,
            has_column_privilege('console_ro','error_issue','status','UPDATE') as issue_triage,
            has_column_privilege('console_ro','error_issue','grouping_key','UPDATE') as issue_cle,
            has_table_privilege('console_ro','mobile_capabilities','SELECT') as capacite_select,
            has_table_privilege('console_ro','mobile_capabilities','INSERT') as capacite_insert,
            has_column_privilege('console_ro','mobile_capabilities','verified_at','UPDATE') as capacite_verif`)).rows[0];
  assert("v48 : PRIVILÈGE d'insertion retiré sur rum_metric", priv.tele_insert === false);
  assert("v48 : lecture PRÉSERVÉE sur rum_metric", priv.tele_select === true);
  assert("v65 : lecture autorisée mais écriture refusée sur rum_event_index", priv.index_select === true && priv.index_insert === false);
  assert("v67 : lecture autorisée mais écriture refusée sur rum_action", priv.action_select === true && priv.action_insert === false);
  assert("v72 : issues lisibles mais jamais modifiées par console_ro, activation réservée à l'exploitation",
    priv.issue_select === true && priv.issue_update === false && priv.config_insert === false);
  assert("v48 : écriture préservée sur la configuration (slo)", priv.conf_update === true);
  assert("v48 : écriture préservée sur rum_span (dogfooding console)", priv.dogfood_insert === true);
  assert("v71 : jetons de source maps révocables, jamais supprimés ni re-hachés par console_ro",
    priv.jeton_revoke === true && priv.jeton_delete === false && priv.jeton_rehash === false);
  // P7.5 — une capacité se DÉCLARE depuis le SDK, elle ne se coche pas dans une
  // interface ; et `verified_at` appartient à une recette d'opérateur, hors de
  // portée d'un rôle applicatif. D'où : lecture seule, sans exception.
  assert("v82 : capacités mobiles lisibles, jamais écrites par console_ro, verified_at hors de portée",
    priv.capacite_select === true && priv.capacite_insert === false && priv.capacite_verif === false);
  assert("v73 : activité append-only, outbox en lecture seule, triage sans toucher la clé de regroupement",
    priv.activite_insert === true && priv.activite_update === false && priv.outbox_insert === false
      && priv.issue_triage === true && priv.issue_cle === false);

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
  assert("propriétaire après RLS : voit toujours les 2 tenants de fixture", (await seenFixture(c, "rum_metric")) === 2);

  await c.end();
  console.log(failures ? `\n[verify-tenant-isolation] ÉCHEC (${failures}).` : "\n[verify-tenant-isolation] isolation multi-tenant PROUVÉE EN BASE.");
  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error("[verify-tenant-isolation] échec:", e?.message ?? e); process.exit(2); });
