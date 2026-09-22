// P*.1, incrément 0-b — l'intervalle de la p75 lu en SQL est celui que calcule le JS.
//
// Au-delà de 30 mesures, `vitalsP75` lit les deux statistiques d'ordre aux rangs
// NORMAUX dans le même balayage que la p75 ; en dessous, il rend les mesures
// triées et le JS applique les rangs EXACTS. Deux implémentations d'une formule
// divergent pour des raisons que la lecture ne montre pas (arrondi de `floor` sur
// un float8, ordre des opérations) : ce fichier les confronte sur un vrai moteur.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
//
// Sans cette variable, la suite est SAUTÉE — et le dit.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  intervalleQuantile,
  rangsQuantileNormal,
  rangsQuantileNormalSql,
} from "../../apps/console/lib/stats/incertitude";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const APP = "pstar-intervalle-app";
const SESSION = "pstar-intervalle-s1";

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

// Valeurs connues, volontairement non triées et avec des ex æquo.
const LCP = Array.from({ length: 40 }, (_, i) => 1500 + ((i * 37) % 40) * 45 + (i % 3 === 0 ? 0 : 7));
const INP = Array.from({ length: 20 }, (_, i) => 80 + ((i * 7) % 20) * 12);
const CLS = [0.01, 0.02, 0.05, 0.03, 0.2, 0.08, 0.04];

if (!url) console.warn("[vitals-intervalle-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

(url ? describe : describe.skip)("intervalle de la p75 : SQL = JS", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let vitalsP75: typeof import("../../apps/console/lib/queries").vitalsP75;
  let pool: { end: () => Promise<void> };

  beforeAll(async () => {
    await c.connect();
    for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    for (const t of ["rum_metric", "rum_session"]) await c.query(`delete from ${t} where app_id = $1`, [APP]);
    await c.query(`insert into app_registry (app_id, name) values ($1, 'P* intervalle') on conflict (app_id) do nothing`, [APP]);
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at)
       values ($1, $2, 'desktop', false, now() - interval '20 minutes', now() - interval '10 minutes')`,
      [SESSION, APP],
    );
    const semer = async (nom: string, valeurs: number[]) => {
      for (const [i, v] of valeurs.entries()) {
        await c.query(
          `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
           values ($1, $2, $3, '/', $4, $5, now() - interval '10 minutes')`,
          [`${APP}-${nom}-${i}`, SESSION, APP, nom, v],
        );
      }
    };
    await semer("LCP", LCP);
    await semer("INP", INP);
    await semer("CLS", CLS);

    delete (globalThis as { pgPool?: unknown }).pgPool;
    vi.resetModules();
    process.env.DATABASE_URL = url;
    ({ vitalsP75 } = await import("../../apps/console/lib/queries"));
    ({ pool } = await import("../../apps/console/lib/db"));
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await c.end();
  });

  const lire = async () => {
    const rows = await vitalsP75({ app: APP, period: "24h", device: null, segment: [] });
    return Object.fromEntries(rows.map((r) => [r.name, r]));
  };
  const trie = (v: number[]) => [...v].sort((a, b) => a - b);

  it("40 mesures : les bornes lues en SQL aux rangs normaux sont celles du JS", async () => {
    const { LCP: lcp } = await lire();
    expect(lcp.n).toBe(40);
    const attendu = intervalleQuantile(trie(LCP));
    expect(attendu.ok).toBe(true);
    if (!attendu.ok) return;
    expect(lcp.intervalle).toEqual({ bas: attendu.bas, haut: attendu.haut, niveau: 0.95, methode: "quantile_normal" });
  });

  it("20 mesures : les valeurs triées remontent, et les rangs exacts s'appliquent", async () => {
    const { INP: inp } = await lire();
    const attendu = intervalleQuantile(trie(INP));
    expect(attendu.ok && attendu.methode).toBe("quantile_exact");
    if (!attendu.ok) return;
    expect(inp.intervalle).toEqual({ bas: attendu.bas, haut: attendu.haut, niveau: 0.95, methode: "quantile_exact" });
  });

  it("7 mesures : refus chiffré, et aucune valeur brute ne sort de la lecture", async () => {
    const { CLS: cls } = await lire();
    expect(cls.intervalle).toEqual({ indisponible: "7 mesures, 13 requises" });
    expect(Object.keys(cls).sort()).toEqual(["intervalle", "n", "name", "p50", "p75"]);
  });

  it("les rangs normaux du SQL sont ceux du JS pour tout n de 30 à 5 000", async () => {
    // L'expression est CELLE de vitalsP75 (rangsQuantileNormalSql), pas une copie.
    const { r, s } = rangsQuantileNormalSql("n", "$1");
    const { rows } = await c.query<{ n: number; r: number; s: number }>(
      `select n::int, ${r} as r, ${s} as s from generate_series(30, 5000) n`,
      [1.96],
    );
    const ecarts = rows.filter((row) => {
      const js = rangsQuantileNormal(row.n);
      return js.r !== row.r || js.s !== row.s;
    });
    expect(ecarts).toEqual([]);
  });
});
