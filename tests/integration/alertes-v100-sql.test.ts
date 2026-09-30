// Vague 4 (lot 4c) — migration-v100 : check_alerts évalue les mesures MIP, sur un
// vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · que v100 se rejoue sans effet : une fonction redéfinie, aucune ligne touchée ;
//   · que le débit descendant se juge au 25ᵉ CENTILE avec « < » : sur les mêmes
//     mesures, un p75 aurait dit « ok » ;
//   · que chaque nouvelle branche lit SA table et SA population : tâches longues
//     sans LoAF (NULL compris), LoAF seul, ressources sans durée écartées, spans
//     `front` seuls, parts de sessions sur les sessions VUES dans la fenêtre ;
//   · qu'une part sans session vue, ou une métrique MIP en écart à l'habitude,
//     rend no_data en le disant — jamais un 0 écrit ;
//   · que le message d'une part garde trois décimales ;
//   · que `error_rate` n'a pas bougé : toutes sources, à dessein (voir l'en-tête
//     de v100).
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V100 = readFileSync(join(SQL_DIR, "migration-v100.sql"), "utf8");

/** Préfixe des apps de ce fichier : le nettoyage ne touche rien d'autre. */
const PREFIXE = "v100-";
const TABLES = ["rum_metric", "rum_longtask", "rum_resource", "rum_span", "rum_event", "rum_error", "rum_pageview"];

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool): Promise<void> {
  // `alert_event` et `alert_delivery` partent en cascade avec leur règle.
  await db.query("delete from alert_rule where app_id like $1", [`${PREFIXE}%`]);
  for (const t of TABLES) await db.query(`delete from ${t} where app_id like $1`, [`${PREFIXE}%`]);
  await db.query("delete from rum_session where app_id like $1", [`${PREFIXE}%`]);
  await db.query("delete from app_registry where app_id like $1", [`${PREFIXE}%`]);
}

let n = 0;
const id = (app: string) => `${app}-${(n += 1)}`;

async function app(db: pg.Pool, a: string, sessions = 1): Promise<string[]> {
  await db.query("insert into app_registry (app_id, name, active) values ($1, $1, true) on conflict (app_id) do nothing", [a]);
  const ids = Array.from({ length: sessions }, (_, i) => `${a}-s${i}`);
  for (const s of ids) {
    await db.query("insert into rum_session (session_id, app_id) values ($1, $2) on conflict do nothing", [s, a]);
  }
  return ids;
}

/** Une page vue il y a `minutes` minutes (5 par défaut : dans toute fenêtre de test). */
async function vue(db: pg.Pool, a: string, session: string, { route = "/", minutes = 5 } = {}): Promise<void> {
  await db.query(
    "insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, $4, now() - make_interval(mins => $5))",
    [id(a), session, a, route, minutes],
  );
}

async function mesure(db: pg.Pool, a: string, name: string, value: number): Promise<void> {
  await db.query(
    "insert into rum_metric (span_id, session_id, app_id, route, name, value, ts) values ($1, $2, $3, '/', $4, $5, now() - interval '5 minutes')",
    [id(a), `${a}-s0`, a, name, value],
  );
}

async function tache(db: pg.Pool, a: string, duree: number, source: string | null): Promise<void> {
  await db.query(
    "insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, ts) values ($1, $2, $3, '/', $4, $5, now() - interval '5 minutes')",
    [id(a), `${a}-s0`, a, duree, source],
  );
}

async function ressource(db: pg.Pool, a: string, duree: number | null): Promise<void> {
  await db.query(
    "insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, ts) values ($1, $2, $3, '/', 'https://cdn.exemple.test/a.js', 'script', $4, now() - interval '5 minutes')",
    [id(a), `${a}-s0`, a, duree],
  );
}

async function span(db: pg.Pool, a: string, tier: "front" | "back", duree: number): Promise<void> {
  const s = id(a);
  await db.query(
    "insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, duration_ms, ts) values ($1, $1, $2, $3, $4, '/', $5, now() - interval '5 minutes')",
    [s, tier, `${a}-s0`, a, duree],
  );
}

async function evenement(db: pg.Pool, a: string, session: string, name: string): Promise<void> {
  await db.query(
    "insert into rum_event (span_id, session_id, app_id, route, name, ts) values ($1, $2, $3, '/', $4, now() - interval '5 minutes')",
    [id(a), session, a, name],
  );
}

async function erreur(db: pg.Pool, a: string, session: string, source: string, occurrences = 1): Promise<void> {
  await db.query(
    `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_source, occurrences, ts)
     values ($1, $2, $3, '/', 'error', 'boom', $4, $5, now() - interval '5 minutes')`,
    [id(a), session, a, source, occurrences],
  );
}

async function regle(
  db: pg.Pool,
  a: string,
  metric: string,
  { comparateur = ">", seuil = 0, mode = "threshold", fenetre = 60 } = {},
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `insert into alert_rule (app_id, metric, comparator, threshold, window_minutes, mode, severity)
     values ($1, $2, $3, $4, $5, $6, 'warning') returning id`,
    [a, metric, comparateur, seuil, fenetre, mode],
  );
  return Number(rows[0].id);
}

type Etat = { last_state: string | null; last_value: number | null; last_reason: string | null };
const etat = async (db: pg.Pool, r: number): Promise<Etat> =>
  (await db.query<Etat>("select last_state, last_value, last_reason from alert_rule where id = $1", [r])).rows[0];
const messages = async (db: pg.Pool, r: number) =>
  (await db.query<{ message: string }>("select message from alert_event where rule_id = $1", [r])).rows.map((x) => x.message);
const evaluer = async (db: pg.Pool): Promise<number> => Number((await db.query("select check_alerts() as n")).rows[0].n);

const suite = url ? describe : describe.skip;

suite("migration-v100 — les mesures MIP dans check_alerts (PostgreSQL)", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 2 } : { max: 2 });

  beforeAll(async () => {
    for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    await nettoyer(pool);
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool);
    await pool.end();
  });

  it("se rejoue sans effet : check_alerts redéfinie, aucune règle ni aucun événement touché", async () => {
    const A = `${PREFIXE}rejeu`;
    await app(pool, A);
    const r = await regle(pool, A, "LCP", { seuil: 4000 });
    await pool.query("insert into alert_event (rule_id, value, message, severity) values ($1, 1, 'v100-rejeu', 'info')", [r]);
    const empreinte = async () =>
      (await pool.query(`select (select md5(string_agg(t::text, ',' order by t.id)) from alert_rule t) as regles,
                                (select md5(string_agg(t::text, ',' order by t.id)) from alert_event t) as evenements`)).rows[0];
    const avant = await empreinte();

    // Dans une transaction, comme le migrateur : `set local` n'a de sens qu'ainsi.
    await pool.query(`begin; ${V100}; commit;`);
    await pool.query(`begin; ${V100}; commit;`);

    expect(await empreinte()).toEqual(avant);
    const f = await pool.query("select obj_description('check_alerts()'::regprocedure) as c");
    expect(f.rows[0].c).toMatch(/\(v100\)/);
  });

  it("DOWNLINK : 25ᵉ centile et « < » — mauvais, là où un p75 aurait dit « ok »", async () => {
    const A = `${PREFIXE}debit`;
    await app(pool, A);
    // p25 = 0,5 Mbit/s ; p75 = 8 Mbit/s.
    for (const v of [0.5, 0.5, 8, 8]) await mesure(pool, A, "DOWNLINK", v);
    const r = await regle(pool, A, "DOWNLINK", { comparateur: "<", seuil: 1 });

    await evaluer(pool);

    expect(await etat(pool, r)).toEqual({ last_state: "breached", last_value: 0.5, last_reason: null });
    // Deux décimales pour un débit.
    expect(await messages(pool, r)).toEqual([`DOWNLINK < 0.50 (seuil 1, fenêtre 60 min, app ${A})`]);
  });

  it("longtask_p75 et loaf_p75 : chacun son API, NULL compté avec les Long Tasks", async () => {
    const A = `${PREFIXE}taches`;
    await app(pool, A);
    for (const d of [300, 300, 300]) await tache(pool, A, d, "longtask");
    await tache(pool, A, 300, null);
    for (const d of [60, 60, 60, 60]) await tache(pool, A, d, "loaf");
    const lt = await regle(pool, A, "longtask_p75", { seuil: 250 });
    const loaf = await regle(pool, A, "loaf_p75", { seuil: 250 });

    await evaluer(pool);

    expect(await etat(pool, lt)).toMatchObject({ last_state: "breached", last_value: 300 });
    expect(await etat(pool, loaf)).toMatchObject({ last_state: "ok", last_value: 60 });
  });

  it("resource_p75 : les ressources sans durée sont écartées", async () => {
    const A = `${PREFIXE}ressources`;
    await app(pool, A);
    for (const d of [1200, 1200, 1200, 1200]) await ressource(pool, A, d);
    await ressource(pool, A, null);
    const r = await regle(pool, A, "resource_p75", { seuil: 1000 });

    await evaluer(pool);

    expect(await etat(pool, r)).toMatchObject({ last_state: "breached", last_value: 1200 });
  });

  it("api_p75 : les spans `front` seuls, le serveur ne compte pas", async () => {
    const A = `${PREFIXE}api`;
    await app(pool, A);
    for (const d of [1500, 1500, 1500, 1500]) await span(pool, A, "front", d);
    for (let i = 0; i < 20; i += 1) await span(pool, A, "back", 10);
    const r = await regle(pool, A, "api_p75", { seuil: 1000 });

    await evaluer(pool);

    expect(await etat(pool, r)).toMatchObject({ last_state: "breached", last_value: 1500 });
  });

  it("rage_rate et dead_rate : part des sessions vues, trois décimales au message", async () => {
    const A = `${PREFIXE}clics`;
    const s = await app(pool, A, 5);
    for (const x of s.slice(0, 4)) await vue(pool, A, x);
    // Deux clics rageurs dans la même session : une session touchée, pas deux.
    await evenement(pool, A, s[0], "frustration.rage");
    await evenement(pool, A, s[0], "frustration.rage");
    // Une session sans page vue dans la fenêtre n'est pas de la population.
    await vue(pool, A, s[4], { minutes: 600 });
    await evenement(pool, A, s[4], "frustration.rage");
    const rage = await regle(pool, A, "rage_rate", { seuil: 0.05 });
    const dead = await regle(pool, A, "dead_rate", { seuil: 0.08 });

    await evaluer(pool);

    expect(await etat(pool, rage)).toMatchObject({ last_state: "breached", last_value: 0.25 });
    expect(await messages(pool, rage)).toEqual([`rage_rate > 0.250 (seuil 0.05, fenêtre 60 min, app ${A})`]);
    // Aucun clic mort : 0 % est une mesure, pas une absence.
    expect(await etat(pool, dead)).toMatchObject({ last_state: "ok", last_value: 0 });
  });

  it("browser_error_session_rate : erreurs NAVIGATEUR seules ; error_rate, lui, compte toutes les sources", async () => {
    const A = `${PREFIXE}erreurs`;
    const s = await app(pool, A, 4);
    for (const x of s) await vue(pool, A, x);
    await erreur(pool, A, s[0], "browser_js");
    await erreur(pool, A, s[1], "node", 3);
    const part = await regle(pool, A, "browser_error_session_rate", { seuil: 0.05 });
    const taux = await regle(pool, A, "error_rate", { seuil: 10 });

    await evaluer(pool);

    expect(await etat(pool, part)).toMatchObject({ last_state: "breached", last_value: 0.25 });
    // Inchangé depuis v86, à dessein : (1 + 3) occurrences ÷ 4 pages vues.
    expect(await etat(pool, taux)).toMatchObject({ last_state: "ok", last_value: 1 });
  });

  it("une part sans session vue rend no_data et le dit — jamais 0 %", async () => {
    const A = `${PREFIXE}vide`;
    await app(pool, A);
    const r = await regle(pool, A, "dead_rate", { seuil: 0.08 });

    await evaluer(pool);

    expect(await etat(pool, r)).toEqual({
      last_state: "no_data",
      last_value: null,
      last_reason: "aucune session avec une page vue sur la fenêtre : part incalculable",
    });
  });

  it("écart à l'habitude sur une mesure MIP : no_data, rien de calculé ; une phase de rum_metric le garde", async () => {
    const A = `${PREFIXE}habitude`;
    await app(pool, A);
    await tache(pool, A, 900, "longtask");
    await mesure(pool, A, "DNS", 40);
    const lt = await regle(pool, A, "longtask_p75", { mode: "baseline" });
    const dns = await regle(pool, A, "DNS", { mode: "baseline" });

    await evaluer(pool);

    expect(await etat(pool, lt)).toEqual({
      last_state: "no_data",
      last_value: null,
      last_reason: "longtask_p75 : seuil fixe seulement, l'écart à l'habitude ne sait pas calculer cette mesure",
    });
    // La phase passe par la branche générique (p75) puis par `metric_baseline`.
    expect(await etat(pool, dns)).toMatchObject({ last_state: "no_data", last_value: 40 });
    expect((await etat(pool, dns)).last_reason).toMatch(/fenêtre\(s\) comparable\(s\), 4 requises$/);
  });
});
