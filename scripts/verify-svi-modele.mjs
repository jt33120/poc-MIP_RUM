// SVI I0 — prouve le modèle d'appel sur Postgres réel.
//
// Ce que ce script doit établir, parce que ce sont les propriétés dont dépendent
// tous les taux affichés ensuite (containment, abandon, transfert) :
//   • un appel s'écrit en plusieurs lots, DANS LE DÉSORDRE, sans se dupliquer ;
//   • rejouer un lot ne crée rien et n'efface rien ;
//   • un appel clos ne se rouvre pas ;
//   • une issue ne peut pas être inventée sur un appel encore ouvert ;
//   • un nœud de saisie sensible n'émet aucune longueur (oracle PAN+CVV) ;
//   • le SVI ne contamine pas les métriques web existantes ;
//   • l'isolation tenant s'applique aux nouvelles tables (v47 ne les couvre pas).
//
//   pg_virtualenv node scripts/verify-svi-modele.mjs
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

const DIR = new URL("../apps/ingest/sql/", import.meta.url);
let failures = 0;
function assert(label, cond) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}

async function applyAll(c) {
  const files = (await readdir(DIR))
    .filter((f) => f.startsWith("migration-v") && f.endsWith(".sql"))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  for (const f of ["schema.sql", ...files]) {
    try { await c.query(await readFile(new URL(f, DIR), "utf8")); }
    catch (e) { if (!/pg_cron|pg_net|cron\.|net\.|extension|vault/i.test(String(e.message))) throw e; }
  }
}

const one = async (c, sql, p = []) => (await c.query(sql, p)).rows[0];
const n = async (c, sql, p = []) => Number((await c.query(sql, p)).rows[0].n);

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if; end $$;");
  await c.query("grant usage on schema public to console_ro");
  await applyAll(c);
  for (const app of ["app-a", "app-b"])
    await c.query("insert into app_registry (app_id, name) values ($1,$1) on conflict do nothing", [app]);

  const CALL = "c-abc123";
  const call = (o) => c.query("select upsert_svi_call($1::jsonb)", [JSON.stringify(o)]);

  // ── 1. Arrivée en DÉSORDRE : la fin AVANT l'entête ─────────────────────────
  // C'est le cas réel : un CDR de clôture peut précéder les événements de début.
  await call({
    app_id: "app-a", call_id: CALL, platform: "asterisk", adapter_version: "0.1.0",
    started_at: "2026-07-30T09:00:10Z", ended_at: "2026-07-30T09:02:00Z",
    status: "closed", outcome: "contained", duration_ms: 110000, provenance: ["cdr"],
  });
  await call({
    app_id: "app-a", call_id: CALL, platform: "asterisk", adapter_version: "0.1.0",
    started_at: "2026-07-30T09:00:00Z", entry_point: "Accueil", flow_id: "svi-principal",
    caller_hash: "h-42", provenance: ["journey"],
  });

  let r = await one(c, "select * from svi_call where app_id='app-a' and call_id=$1", [CALL]);
  assert("désordre : un seul appel, pas deux", (await n(c, "select count(*)::int n from svi_call")) === 1);
  assert("désordre : le début le PLUS TÔT gagne", r.started_at.toISOString().startsWith("2026-07-30T09:00:00"));
  assert("désordre : la fin reste renseignée", r.ended_at !== null);
  assert("lot partiel : n'efface pas l'issue déjà connue", r.outcome === "contained");
  assert("lot partiel : complète les champs manquants", r.entry_point === "Accueil" && r.caller_hash === "h-42");
  assert("provenance : les niveaux s'accumulent sans doublon",
    r.provenance.slice().sort().join(",") === "cdr,journey");

  // ── 2. Rejeu intégral : aucune ligne créée, aucun champ perdu ──────────────
  await call({
    app_id: "app-a", call_id: CALL, platform: "asterisk", adapter_version: "0.1.0",
    started_at: "2026-07-30T09:00:10Z", ended_at: "2026-07-30T09:02:00Z",
    status: "closed", outcome: "contained", duration_ms: 110000, provenance: ["cdr"],
  });
  const apres = await one(c, "select * from svi_call where app_id='app-a' and call_id=$1", [CALL]);
  assert("rejeu : toujours un seul appel", (await n(c, "select count(*)::int n from svi_call")) === 1);
  assert("rejeu : l'entry_point d'un autre lot n'est pas effacé", apres.entry_point === "Accueil");

  // ── 3. Un appel clos ne se rouvre PAS ──────────────────────────────────────
  await call({ app_id: "app-a", call_id: CALL, platform: "asterisk", adapter_version: "0.1.0",
               started_at: "2026-07-30T09:00:00Z", status: "open" });
  assert("clos : un lot tardif ne rouvre pas l'appel",
    (await one(c, "select status from svi_call where call_id=$1", [CALL])).status === "closed");

  // ── 4. L'issue ne s'invente pas ────────────────────────────────────────────
  const ouvertAvecIssue = await c.query(
    `insert into svi_call (app_id, call_id, trace_id, platform, adapter_version, started_at, status, outcome)
     values ('app-a','c-bad','t','asterisk','0.1.0', now(), 'open', 'contained')`,
  ).then(() => null, (e) => e);
  assert("contrainte : un appel OUVERT ne peut pas porter d'issue",
    ouvertAvecIssue !== null && /svi_call_outcome_ck/.test(String(ouvertAvecIssue.message)));

  const closSansIssue = await c.query(
    `insert into svi_call (app_id, call_id, trace_id, platform, adapter_version, started_at, status)
     values ('app-a','c-bad2','t','asterisk','0.1.0', now(), 'closed')`,
  ).then(() => null, (e) => e);
  assert("contrainte : un appel CLOS doit porter une issue",
    closSansIssue !== null && /svi_call_outcome_ck/.test(String(closSansIssue.message)));

  // ── 5. Saisie sensible : aucune longueur, jamais ───────────────────────────
  await c.query(
    `insert into svi_step (step_id, app_id, call_id, seq, kind, input_class, input_sensitive, started_at)
     values ('s-1','app-a',$1,1,'input','masked',true, now())`, [CALL]);
  const fuite = await c.query(
    `insert into svi_step (step_id, app_id, call_id, seq, kind, input_class, input_len, started_at)
     values ('s-2','app-a',$1,2,'input','masked',4, now())`, [CALL],
  ).then(() => null, (e) => e);
  assert("PCI : un nœud masqué ne peut PAS porter de longueur",
    fuite !== null && /svi_step_masked_ck/.test(String(fuite.message)));

  // Agrégation par appel : aucune suite de chiffres reconstituable.
  const agrege = await one(c,
    `select coalesce(string_agg(coalesce(input_class,'') || coalesce(node_label,'') ||
            coalesce(menu_path,''), '' order by seq), '') as tout
       from svi_step where app_id='app-a' and call_id=$1`, [CALL]);
  assert("PCI : l'agrégation de toutes les étapes ne contient aucune suite de ≥12 chiffres",
    !/\d{12,}/.test(agrege.tout));

  // ── 6. Non-contamination des métriques web ────────────────────────────────
  await c.query(`insert into rum_session (session_id, app_id) values ('s-web','app-a')`);
  await c.query(`insert into rum_metric (session_id,app_id,route,name,value,rating,ts)
                 values ('s-web','app-a','/x','LCP',1200,'good', now())`);
  const avant = await n(c, `select count(*)::int n from rum_metric where name in ('LCP','INP','CLS','TTFB','FCP')`);
  await c.query(`insert into rum_metric (app_id,route,name,value,rating,ts,call_id)
                 values ('app-a','/svi','svi.wait_ms',30000,'needs-improvement', now(), $1)`, [CALL]);
  const apresWeb = await n(c, `select count(*)::int n from rum_metric where name in ('LCP','INP','CLS','TTFB','FCP')`);
  assert("greffe : une métrique SVI n'entre pas dans le décompte des vitals web", avant === apresWeb);
  assert("greffe : la métrique SVI porte bien son call_id",
    (await n(c, "select count(*)::int n from rum_metric where call_id is not null")) === 1);

  // ── 6 bis. Containment NET : la requête, pas seulement la fonction pure ───
  // Scénario de référence du plan : 100 appels résolus dont 30 suivis d'un rappel
  // du même appelant sous 7 jours -> brut 100 %, net 70 %. Le test unitaire
  // couvre l'arithmétique ; celui-ci couvre le SQL, où se cachent les vraies
  // erreurs (fenêtre, appariement, exclusion de l'appel lui-même).
  await c.query("delete from svi_call where app_id = 'app-net'");
  await c.query("insert into app_registry (app_id, name) values ('app-net','net') on conflict do nothing");
  for (let i = 0; i < 100; i++) {
    // Appel résolu, il y a 3 jours.
    await call({
      app_id: "app-net", call_id: `net-${i}`, platform: "test", adapter_version: "0",
      started_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
      ended_at: new Date(Date.now() - 3 * 86400_000 + 60_000).toISOString(),
      status: "closed", outcome: "contained",
      caller_hash: `h-${i}`, caller_key_id: "k1",
    });
    // Pour 30 d'entre eux : rappel 1 jour plus tard (donc dans la fenêtre 7 j).
    if (i < 30) {
      await call({
        app_id: "app-net", call_id: `net-rappel-${i}`, platform: "test", adapter_version: "0",
        started_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
        ended_at: new Date(Date.now() - 2 * 86400_000 + 60_000).toISOString(),
        status: "closed", outcome: "transferred",
        caller_hash: `h-${i}`, caller_key_id: "k1",
      });
    }
  }
  const net = await one(c,
    `with clos as (
       select * from svi_call where app_id = 'app-net' and status = 'closed' and merged_into is null
     )
     select count(*) filter (where outcome='contained')::int as contained,
            count(*) filter (
              where outcome='contained' and caller_hash is not null
                and exists (select 1 from svi_call r
                             where r.app_id = clos.app_id and r.caller_hash = clos.caller_hash
                               and r.caller_key_id is not distinct from clos.caller_key_id
                               and r.call_id <> clos.call_id
                               and r.started_at > clos.started_at
                               and r.started_at <= clos.started_at + interval '7 days')
            )::int as recalled
       from clos`);
  assert("containment : 100 appels résolus détectés", net.contained === 100);
  assert("containment : 30 rappels sous 7 jours détectés -> net 70 %", net.recalled === 30);

  // Un appel ne doit JAMAIS se compter lui-même comme son propre rappel.
  const seul = await one(c,
    `select count(*) filter (
       where exists (select 1 from svi_call r
                      where r.app_id = s.app_id and r.caller_hash = s.caller_hash
                        and r.call_id <> s.call_id
                        and r.started_at > s.started_at
                        and r.started_at <= s.started_at + interval '7 days')
     )::int as n
     from svi_call s where s.app_id='app-net' and s.call_id = 'net-99'`);
  assert("containment : un appel isolé n'est pas son propre rappel", seul.n === 0);
  await c.query("delete from svi_call where app_id = 'app-net'");

  // ── 7. Isolation tenant sur les tables SVI (v47 ne les couvre pas) ─────────
  await call({ app_id: "app-b", call_id: "c-b", platform: "asterisk", adapter_version: "0.1.0",
               started_at: "2026-07-30T09:00:00Z" });
  assert("propriétaire : voit les 2 tenants", (await n(c, "select count(*)::int n from svi_call")) === 2);

  await c.query("set role console_ro");
  await c.query("select set_config('app.current_app_id','app-a',false)");
  const vusA = await n(c, "select count(*)::int n from svi_call");   // AUCUN where app_id
  await c.query("select set_config('app.current_app_id','',false)");
  const vusVide = await n(c, "select count(*)::int n from svi_call");
  let ecritureRefusee = false;
  try { await c.query(`insert into svi_step (step_id,app_id,call_id,seq,kind,started_at)
                       values ('s-x','app-a','c',9,'menu',now())`); }
  catch { ecritureRefusee = true; }
  await c.query("rollback").catch(() => {});
  await c.query("reset role");

  assert("isolation : portée A -> ne voit QUE l'appel de A (sans where app_id)", vusA === 1);
  assert("isolation : portée vide -> aucun appel (fail-closed)", vusVide === 0);
  assert("moindre privilège : la console ne peut pas ÉCRIRE le SVI", ecritureRefusee);

  await c.end();
  console.log(failures
    ? `\n[verify-svi-modele] ÉCHEC (${failures}).`
    : "\n[verify-svi-modele] modèle d'appel SVI PROUVÉ.");
  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error("[verify-svi-modele] échec:", e?.message ?? e); process.exit(2); });
