// P1 — signaux de frustration : prouve sur Postgres réel que (1) les rage/dead
// clicks stockés dans rum_event ('frustration.<kind>') s'agrègent comme attendu et
// (2) l'attribution INP (rum_metric.attribution->>'interactionTarget') ressort le
// bon élément. La lecture console passe par rum_event/rum_metric, déjà couverts par
// la purge/effacement/métering (pas de nouvelle table). NB : l'accès console_ro aux
// tables de BASE relève d'un drift repo↔live distinct (cf. note de la PR), non testé ici.
//   pg_virtualenv node scripts/verify-frustration.mjs
import { readFile } from "node:fs/promises";
import pg from "pg";

const SQL = (f) => new URL(`../apps/ingest/sql/${f}`, import.meta.url);
const MIGR = ["schema.sql", ...["02","03","04","05","07","08","09","10","11","12","13","14","15"].map((n) => `migration-v${n}.sql`)];

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

// Requêtes calquées sur lib/queries-frustration.ts (fenêtre = '7 days').
const Q_FRUSTRATION = `
  select coalesce(e.route,'(inconnu)') as route, replace(e.name,'frustration.','') as kind,
         coalesce(e.props->>'target','(inconnu)') as target, count(*)::int as n
  from rum_event e left join rum_session s using (session_id)
  where e.name in ('frustration.rage','frustration.dead') and e.ts > now() - interval '7 days'
    and ($1::text is null or e.app_id=$1) and ($2::text is null or s.device_type=$2)
  group by 1,2,3 order by n desc`;
const Q_INP = `
  select coalesce(m.attribution->>'interactionTarget','(inconnu)') as target, count(*)::int as n,
         percentile_cont(0.75) within group (order by m.value) as p75, max(m.value) as worst
  from rum_metric m left join rum_session s using (session_id)
  where m.name='INP' and m.attribution is not null and m.ts > now() - interval '7 days'
    and ($1::text is null or m.app_id=$1) and ($2::text is null or s.device_type=$2)
  group by 1 order by p75 desc nulls last`;

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await applyAll(c);

  await c.query("insert into rum_session (session_id, app_id, device_type) values ('s1','app-a','desktop'),('s2','app-a','mobile')");

  // 4 rage clicks sur "button Payer" (/checkout, desktop) + 1 dead + 1 sur mobile.
  const ev = (sid, route, kind, target) =>
    c.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ($1,$2,'app-a',$3,$4,$5, now() - interval '1 hour')`,
      [`sp-${Math.random().toString(36).slice(2)}`, sid, route, `frustration.${kind}`, JSON.stringify({ target, count: 1 })],
    );
  for (let i = 0; i < 4; i++) await ev("s1", "/checkout", "rage", 'button "Payer"');
  await ev("s1", "/checkout", "dead", 'a "Aide"');
  await ev("s2", "/home", "rage", 'div "Menu"');

  // INP avec attribution : élément lent #search (2 mesures) + #ok (1 rapide).
  const inp = (sid, value, target) =>
    c.query(
      `insert into rum_metric (session_id, app_id, route, name, value, rating, attribution, ts)
       values ($1,'app-a','/x','INP',$2,'poor',$3, now() - interval '1 hour')`,
      [sid, value, JSON.stringify({ interactionTarget: target, interactionType: "pointer" })],
    );
  await inp("s1", 600, "#search");
  await inp("s1", 800, "#search");
  await inp("s1", 120, "#ok");

  // --- agrégats (propriétaire) ---
  const fr = (await c.query(Q_FRUSTRATION, [null, null])).rows;
  const rage = fr.find((r) => r.kind === "rage" && r.target === 'button "Payer"');
  assert("rage 'button Payer' /checkout regroupé → n=4", rage && rage.n === 4);
  assert("dead distinct du rage (lignes séparées)", fr.some((r) => r.kind === "dead" && r.n === 1));
  assert("filtre device=mobile → ne garde que le rage mobile", (await c.query(Q_FRUSTRATION, [null, "mobile"])).rows.every((r) => r.target === 'div "Menu"'));

  const inpRows = (await c.query(Q_INP, [null, null])).rows;
  assert("INP : pire élément = #search en tête (p75 le plus haut)", inpRows[0].target === "#search" && Number(inpRows[0].n) === 2);
  assert("INP : worst #search = 800", Number(inpRows[0].worst) === 800);

  await c.end();
  console.log(process.exitCode ? "\n[verify-frustration] ÉCHEC." : "\n[verify-frustration] signaux de frustration + INP VÉRIFIÉS.");
}

main().catch((e) => { console.error("[verify-frustration] échec:", e?.message ?? e); process.exit(2); });
