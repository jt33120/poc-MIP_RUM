// F13 (revue) — « Nouvelle release face à la précédente » : A et B sont LUES une à une.
//
// `comparaisonVersions(f, 12)` s'arrête aux 12 releases les plus vues. Une release venue
// de l'URL (lien d'annotation, constat de déploiement) hors de ces 12 y manque : lue
// là, elle aurait « 0 session » et `ReleaseCompare` écrirait « aucune session de cette
// release » alors que les tuiles montrent ses p75. La lecture intersectée
// `release=<v>` (même fenêtre, même périmètre) la trouve, avec ses sessions.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const APP = "f13-releases";
const HEURE = 3_600_000;
const FIN = Math.floor(Date.now() / HEURE) * HEURE;
const DEBUT = FIN - 6 * HEURE;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const t of ["rum_pageview", "rum_session"]) await c.query(`delete from ${t} where app_id = $1`, [APP]);
}

if (!url) console.warn("[vue-ensemble-release-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

(url ? describe : describe.skip)("release hors des 12 plus vues, lue explicitement (F13)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: {
    comparaisonVersions: typeof import("../../apps/console/lib/queries-deploys").comparaisonVersions;
    avecCondition: typeof import("../../apps/console/lib/perf-domain").avecCondition;
    filtersOfQuery: typeof import("../../apps/console/lib/filters").filtersOfQuery;
    pool: { end: () => Promise<void> };
  };

  beforeAll(async () => {
    await c.connect();
    for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    await nettoyer(c);
    // 13 releases : r01 a 13 sessions, r02 en a 12… r13 n'en a qu'une — hors des 12 plus vues.
    for (let i = 1; i <= 13; i++) {
      const release = `r${String(i).padStart(2, "0")}`;
      for (let k = 0; k < 14 - i; k++) {
        const sid = `${APP}-${release}-${k}`;
        const quand = new Date(DEBUT + HEURE + k * 60_000);
        await c.query(
          `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, release)
           values ($1, $2, 'desktop', false, $3, $3, $4)`,
          [sid, APP, quand, release],
        );
        await c.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, started_at, release)
           values ($1, $2, $3, '/', $4, $5)`,
          [`${sid}-pv`, sid, APP, quand, release],
        );
      }
    }
    delete (globalThis as { pgPool?: unknown }).pgPool;
    vi.resetModules();
    process.env.DATABASE_URL = url;
    const { comparaisonVersions } = await import("../../apps/console/lib/queries-deploys");
    const { avecCondition } = await import("../../apps/console/lib/perf-domain");
    const { filtersOfQuery } = await import("../../apps/console/lib/filters");
    const { pool } = await import("../../apps/console/lib/db");
    lib = { comparaisonVersions, avecCondition, filtersOfQuery, pool };
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  const filtres = () => {
    const parsed = parseAnalyticsQuery(new URLSearchParams(`app=${APP}&from=${iso(DEBUT)}&to=${iso(FIN)}`), {
      principal: ADMIN,
      nowMs: Date.now(),
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    return lib.filtersOfQuery(parsed.value);
  };

  it("la liste plafonnée à 12 ne contient pas r13", async () => {
    const { rows } = await lib.comparaisonVersions(filtres(), 12);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.version)).not.toContain("r13");
  });

  it("la lecture intersectée release=r13 la trouve, avec sa session", async () => {
    const { rows } = await lib.comparaisonVersions(lib.avecCondition(filtres(), "release", "r13"), 12);
    expect(rows).toEqual([expect.objectContaining({ version: "r13", sessions: 1 })]);
  });
});
