// P6.6 — banc de mesure de l'Explorer, reproductible et HORS CI.
//
// POURQUOI UN TEST, ET PAS UN SCRIPT. Le banc doit mesurer le SQL RÉELLEMENT
// exécuté en production, pas une transcription à la main qui dériverait au
// premier changement du compilateur. Il passe donc par `analytics-compiler.ts` et
// `exploreAnalytics` — le même chemin que l'API et l'écran.
//
// POURQUOI IL NE TOURNE PAS EN CI. Il exige une base de 1,2 M de lignes que ni la
// CI ni un poste de développement ne doivent construire à chaque commit : sans
// `BENCH_DATABASE_URL`, il est ignoré. Ce fichier NE SÈME RIEN et N'EFFACE RIEN :
// il lit une base préparée à part (voir l'en-tête de `migration-v80.sql` pour la
// recette de semis et les chiffres obtenus).
//
//   BENCH_DATABASE_URL=postgres://postgres:postgres@localhost:5433/p66_bench \
//     pnpm exec vitest run tests/integration/explorer-bench-p66.test.ts
//
// Ce qu'il imprime : le plan `EXPLAIN (ANALYZE, BUFFERS)` de chaque lecture, puis
// la latence de bout en bout sur 20 exécutions à chaud (p50, p95, max).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  compileGroups,
  compileRollupHistogram,
  compileSeries,
  compileTotal,
  type CompiledSql,
} from "../../apps/console/lib/analytics-compiler";
import { chooseRollup, hybrideDisponible } from "../../apps/console/lib/analytics-rollups";
import { parseExplorerQuery, type ExplorerRequest } from "../../apps/console/lib/analytics-schema";
import { contextFor } from "../../apps/console/lib/query-sql";
import type { ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.BENCH_DATABASE_URL;
const APP = process.env.BENCH_APP_ID ?? "p66-a";
const ADMIN: ScopePrincipal = { role: "admin", apps: null };
/** Exécutions chronométrées par scénario, après une exécution de chauffe. */
const TIRAGES = 20;

/** p95 d'un échantillon trié, par rang (pas d'interpolation : 20 tirages). */
function percentile(mesures: number[], p: number): number {
  const trie = [...mesures].sort((a, b) => a - b);
  return trie[Math.min(trie.length - 1, Math.ceil(p * trie.length) - 1)];
}

const SCENARIOS: Array<{ nom: string; ast: Record<string, unknown> }> = [
  {
    nom: "événements — total 7 j",
    ast: { dataset: "custom_events", measure: { aggregation: "count", field: "rows" } },
  },
  {
    nom: "événements — total 24 h (candidat (app_id, ts))",
    ast: { dataset: "custom_events", measure: { aggregation: "count", field: "rows" }, range: { preset: "24h" } },
  },
  {
    nom: "événements — filtre release 24 h (candidat (app_id, release, ts))",
    ast: {
      dataset: "custom_events",
      measure: { aggregation: "count", field: "rows" },
      range: { preset: "24h" },
      filters: [{ field: "release", operator: "eq", type: "string", value: "r3.0.0" }],
    },
  },
  {
    nom: "événements — filtre env sélectif 24 h (candidat (app_id, env, ts))",
    ast: {
      dataset: "custom_events",
      measure: { aggregation: "count", field: "rows" },
      range: { preset: "24h" },
      filters: [{ field: "env", operator: "eq", type: "string", value: "dev" }],
    },
  },
  {
    nom: "événements — série temporelle 24 h, groupe release (candidat (app_id, ts))",
    ast: {
      dataset: "custom_events",
      measure: { aggregation: "count", field: "rows" },
      range: { preset: "24h" },
      visualization: "timeseries",
      groupBy: ["release"],
      limit: 5,
    },
  },
  {
    nom: "événements — classement par release, 7 j",
    ast: {
      dataset: "custom_events",
      measure: { aggregation: "count", field: "rows" },
      visualization: "toplist",
      groupBy: ["release"],
      limit: 10,
    },
  },
  {
    nom: "événements — filtre release, 7 j (candidat (app_id, release, ts))",
    ast: {
      dataset: "custom_events",
      measure: { aggregation: "count", field: "rows" },
      filters: [{ field: "release", operator: "eq", type: "string", value: "r3.0.0" }],
    },
  },
  {
    nom: "événements — filtre env, série temporelle 7 j (candidat (app_id, env, ts))",
    ast: {
      dataset: "custom_events",
      measure: { aggregation: "count", field: "rows" },
      filters: [{ field: "env", operator: "eq", type: "string", value: "prod" }],
      visualization: "timeseries",
      groupBy: ["release"],
      limit: 5,
    },
  },
  {
    nom: "erreurs — somme des occurrences, filtre env, groupe release",
    ast: {
      dataset: "errors",
      measure: { aggregation: "sum", field: "occurrences" },
      filters: [{ field: "env", operator: "eq", type: "string", value: "prod" }],
      visualization: "toplist",
      groupBy: ["release"],
      limit: 10,
    },
  },
  {
    nom: "vitals — p75 LCP par appareil (chemin agrégat)",
    ast: {
      dataset: "vitals",
      measure: { aggregation: "p75", field: "value" },
      variant: "LCP",
      visualization: "toplist",
      groupBy: ["device"],
      limit: 10,
    },
  },
  {
    nom: "sessions — visiteurs distincts 7 j (jamais agrégeable)",
    ast: { dataset: "sessions", measure: { aggregation: "distinct", field: "visitors" } },
  },
];

async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const explorer = await import("../../apps/console/lib/queries-explorer");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...explorer, ...schema, pool };
}

(url ? describe : describe.skip)("Banc de mesure de l'Explorer (P6.6)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Awaited<ReturnType<typeof consoleSur>>;

  function requete(ast: Record<string, unknown>): ExplorerRequest {
    // La plage par défaut du banc est 7 jours ; un scénario peut en imposer une autre.
    const parsed = parseExplorerQuery(
      { version: 1, app: APP, range: { preset: "7d" }, ...ast },
      { principal: ADMIN, nowMs: Date.now() },
    );
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  }

  beforeAll(async () => {
    await c.connect();
    lib = await consoleSur(url!);
  }, 120_000);

  afterAll(async () => {
    await lib?.pool.end();
    await c.end();
  });

  it("consigne la taille des tables mesurées", async () => {
    const { rows } = await c.query<{ ligne: string }>(
      `select relname || ' : ' || n_live_tup || ' lignes, ' || pg_size_pretty(pg_total_relation_size(relid)) as ligne
         from pg_stat_user_tables where n_live_tup > 10000 order by n_live_tup desc`,
    );
    console.log(`\n=== Base ${new URL(url!).pathname.slice(1)} ===`);
    for (const r of rows) console.log(`  ${r.ligne}`);
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const scenario of SCENARIOS) {
    it(
      `mesure « ${scenario.nom} »`,
      async () => {
        const request = requete(scenario.ast);
        const { query, plan } = request;
        const schema = await lib.dimensionSchema();
        // Le banc doit expliquer le SQL que la lecture exécute VRAIMENT : quand un
        // agrégat répond, c'est la requête hybride, pas les lectures brutes.
        const decision = chooseRollup(plan, query);
        const lectures: Array<[string, (ctx: ReturnType<typeof contextFor>, p: typeof plan) => ReturnType<typeof compileTotal>]> =
          decision.usable && hybrideDisponible(schema)
            ? [["hybride", (ctx, p) => compileRollupHistogram(ctx, p, decision.source)]]
            : [
                ["total", compileTotal],
                ...(plan.visualization === "value" ? [] : ([["groupes", compileGroups]] as const)),
                ...(plan.visualization === "timeseries" ? ([["série", compileSeries]] as const) : []),
              ];

        const compilations: Array<[string, CompiledSql]> = [];
        for (const [nom, compiler] of lectures) {
          const compiled = compiler(contextFor(query, schema), plan);
          if (!compiled.ok) throw new Error(compiled.error.message);
          compilations.push([nom, compiled.value]);
        }

        console.log(`\n### ${scenario.nom}`);
        for (const [nom, sql] of compilations) {
          const { rows } = await c.query<{ "QUERY PLAN": string }>(
            `explain (analyze, buffers) ${sql.text}`,
            sql.params as unknown[],
          );
          const plan = rows.map((r) => r["QUERY PLAN"]);
          // Les accès aux tables (et donc l'index réellement choisi), le temps et
          // les tampons : de quoi juger un plan sans recopier 80 lignes d'arbre.
          const resume = plan.filter((l) => /Scan|Planning Time|Execution Time|Buffers: shared|temp (read|written)/.test(l));
          console.log(`  — ${nom} —`);
          for (const ligne of resume) console.log(`    ${ligne.trim()}`);
        }

        // Chauffe (cache disque et plans), puis la mesure elle-même.
        await lib.exploreAnalytics(request, { timeoutMs: 60_000 });
        const mesures: number[] = [];
        for (let i = 0; i < TIRAGES; i++) {
          const debut = performance.now();
          await lib.exploreAnalytics(request, { timeoutMs: 60_000 });
          mesures.push(performance.now() - debut);
        }
        const ligne = `p50 ${percentile(mesures, 0.5).toFixed(0)} ms · p95 ${percentile(mesures, 0.95).toFixed(0)} ms · max ${Math.max(...mesures).toFixed(0)} ms`;
        console.log(`  → ${ligne}`);
        expect(mesures).toHaveLength(TIRAGES);
      },
      600_000,
    );
  }
});
