// P7.5 — banc de mesure de l'écran `/mobile`, reproductible et HORS CI.
//
// POURQUOI UN BANC. La règle du plan est « index app/plage selon besoin réel
// MESURÉ ». Ajouter un index « parce que ça semble utile » se paie à chaque
// écriture sur `rum_session`, la table la plus chaude du système, et ne se
// remarque jamais. La seule façon honnête de conclure est de construire le
// candidat, de le mesurer, et de le retirer s'il n'est pas choisi.
//
// POURQUOI IL NE TOURNE PAS EN CI. Il exige une base de 120 000 sessions et
// 250 000 erreurs que ni la CI ni un poste ne doivent reconstruire à chaque
// commit : sans `BENCH_DATABASE_URL`, il est ignoré. Il NE SÈME RIEN et
// N'EFFACE RIEN d'autre que son propre index candidat ; le semis est décrit
// dans l'en-tête de `migration-v82.sql`, et se rejoue par `generate_series`
// seul — aucune donnée client n'entre dans un banc.
//
//   BENCH_DATABASE_URL=postgres://postgres:postgres@localhost:5433/p75_bench \
//     pnpm exec vitest run tests/integration/rum-mobile-bench-p75.test.ts
//
// Ce qu'il imprime : le plan `EXPLAIN (ANALYZE, BUFFERS)` de chaque lecture, sans
// puis avec l'index candidat, et la latence de bout en bout après chauffe.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.BENCH_DATABASE_URL;
const APP = process.env.BENCH_APP_ID ?? "p75-bench";
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
/** Exécutions chronométrées par scénario, après une exécution de chauffe. */
const TIRAGES = 9;

// L'index RÉELLEMENT livré par migration-v82. Le banc le retire, mesure, le
// recrée et remesure : il vérifie donc l'index du produit, pas une copie qui
// pourrait en différer d'une colonne. Il le REMET en place à la fin, quelle que
// soit l'issue — une base de banc laissée sans son index mentirait à la mesure
// suivante.
const INDEX_CANDIDAT = "idx_session_app_runtime_v82";

/** Médiane d'un échantillon (9 tirages : le cinquième, sans interpolation). */
function mediane(mesures: number[]): number {
  const trie = [...mesures].sort((a, b) => a - b);
  return trie[Math.floor(trie.length / 2)];
}

/**
 * Le SQL RÉELLEMENT exécuté par `lib/queries-mobile.ts`, recopié ici avec ses
 * paramètres liés. Le banc mesure des PLANS : il n'a pas besoin de la couche
 * TypeScript, mais il a besoin que le texte soit le même — une transcription
 * approximative mesurerait une autre requête.
 */
const SCENARIOS: Array<{ nom: string; sql: string; params: (bornes: { from: string; to: string }) => unknown[] }> = [
  {
    nom: "sessions + visiteurs RN, 24 h",
    sql: `with cohorte as (
            select s.session_id, s.app_id, s.visitor_id from rum_session s
             where s.runtime = 'react_native'
               and s.started_at >= $1::timestamptz and s.started_at < $2::timestamptz
               and s.app_id = any($3::text[]) and not coalesce(s.is_bot, false)
          )
          select count(*)::int as sessions, count(distinct visitor_id)::int as visitors from cohorte`,
    params: (b) => [b.from, b.to, [APP]],
  },
  {
    nom: "sessions + visiteurs RN, 7 j",
    sql: `with cohorte as (
            select s.session_id, s.app_id, s.visitor_id from rum_session s
             where s.runtime = 'react_native'
               and s.started_at >= $1::timestamptz and s.started_at < $2::timestamptz
               and s.app_id = any($3::text[]) and not coalesce(s.is_bot, false)
          )
          select count(*)::int as sessions, count(distinct visitor_id)::int as visitors from cohorte`,
    params: (b) => [b.from, b.to, [APP]],
  },
  {
    nom: "sessions touchées par une erreur JS, 7 j",
    sql: `with cohorte as (
            select s.session_id, s.app_id from rum_session s
             where s.runtime = 'react_native'
               and s.started_at >= $1::timestamptz and s.started_at < $2::timestamptz
               and s.app_id = any($3::text[]) and not coalesce(s.is_bot, false)
          )
          select coalesce(sum(e.occurrences), 0)::float8 as occurrences,
                 count(distinct e.session_id)::int as sessions_affected
            from rum_error e
            join cohorte c on c.app_id = e.app_id and c.session_id = e.session_id
           where e.error_source = 'react_native_js'
             and e.app_id = any($3::text[])
             and e.ts >= $1::timestamptz and e.ts < $2::timestamptz`,
    params: (b) => [b.from, b.to, [APP]],
  },
];

function bornes(jours: number): { from: string; to: string } {
  const to = new Date();
  return { from: new Date(to.getTime() - jours * 86_400_000).toISOString(), to: to.toISOString() };
}

async function mesurer(nom: string, sql: string, params: unknown[]): Promise<{ ms: number; index: boolean }> {
  await pool.query(sql, params); // chauffe
  const mesures: number[] = [];
  for (let i = 0; i < TIRAGES; i++) {
    const t0 = performance.now();
    await pool.query(sql, params);
    mesures.push(performance.now() - t0);
  }
  const ms = mediane(mesures);
  const plan = await pool.query(`explain (analyze, buffers) ${sql}`, params);
  const index = plan.rows.some((r: Record<string, string>) => String(Object.values(r)[0]).includes(INDEX_CANDIDAT));
  console.log(`  ${nom.padEnd(45)} ${ms.toFixed(1).padStart(7)} ms   index candidat ${index ? "CHOISI" : "ignoré"}`);
  return { ms, index };
}

suite("P7.5 — banc /mobile : l'index candidat est-il choisi ?", () => {
  beforeAll(async () => {
    if (!url) return;
    await pool.query(`drop index if exists ${INDEX_CANDIDAT}`);
  }, 120_000);

  afterAll(async () => {
    if (!url) return;
    await pool.query(`create index if not exists ${INDEX_CANDIDAT} on rum_session (app_id, runtime, started_at)`);
    await pool.end();
  });

  it("mesure chaque lecture sans puis avec (app_id, runtime, started_at)", async () => {
    const fenetres = [bornes(1), bornes(7), bornes(7)];
    console.log("\nSANS index candidat");
    const sans: { ms: number; index: boolean }[] = [];
    for (const [i, s] of SCENARIOS.entries()) sans.push(await mesurer(s.nom, s.sql, s.params(fenetres[i])));

    await pool.query(`create index if not exists ${INDEX_CANDIDAT} on rum_session (app_id, runtime, started_at)`);
    await pool.query("analyze rum_session");
    console.log("AVEC index candidat");
    const avec: { ms: number; index: boolean }[] = [];
    for (const [i, s] of SCENARIOS.entries()) avec.push(await mesurer(s.nom, s.sql, s.params(fenetres[i])));
    const choisiApres = avec.every((r) => r.index);

    // Le banc ne fixe aucun seuil de LATENCE : un seuil chiffré sur une machine
    // de développement deviendrait un test instable, et un test instable finit
    // désactivé. Il fixe en revanche le seul fait qui a décidé de livrer l'index :
    // le planificateur le CHOISIT. S'il cessait de le faire, l'index serait à
    // retirer — un index non choisi se paie à chaque écriture, sans contrepartie.
    expect(sans).toHaveLength(SCENARIOS.length);
    expect(avec).toHaveLength(SCENARIOS.length);
    expect(choisiApres, "l'index de v82 n'est plus choisi : le reconsidérer").toBe(true);
  }, 300_000);
});
