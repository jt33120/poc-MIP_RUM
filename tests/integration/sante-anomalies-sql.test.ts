// P*.1, incrément 0-c — la garde d'éligibilité des anomalies, exécutée par healthScore
// sur un vrai PostgreSQL.
//
// La lecture est enveloppée d'un `catch` (vue absente sur une base non migrée) :
// une faute de SQL y devenait « non testable » en silence. C'est arrivé pendant
// l'écriture de ce lot — deux requêtes partageaient un contexte de paramètres. Ce
// test sème une route testable et exige que la composante soit NOTÉE.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const TESTABLE = "pstar-sante-testable";
const VIDE = "pstar-sante-vide";

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

if (!url) console.warn("[sante-anomalies-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

(url ? describe : describe.skip)("composante Anomalies du score de santé", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let healthScore: typeof import("../../apps/console/lib/health").healthScore;
  let pool: { end: () => Promise<void> };

  beforeAll(async () => {
    await c.connect();
    for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    for (const app of [TESTABLE, VIDE]) {
      for (const t of ["rum_metric", "rum_pageview", "rum_session"]) await c.query(`delete from ${t} where app_id = $1`, [app]);
      await c.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
      await c.query(
        `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at)
         values ($1, $2, 'desktop', false, now() - interval '3 hours', now() - interval '30 minutes')`,
        [`${app}-s`, app],
      );
      await c.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
         values ($1, $2, $3, '/a', now() - interval '30 minutes')`,
        [`${app}-pv`, `${app}-s`, app],
      );
    }
    // Six heures passées avec des LCP différents sur /a : la route est testable.
    for (let h = 2; h <= 7; h++) {
      await c.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, '/a', 'LCP', $4, 'good', date_trunc('hour', now()) - make_interval(hours => $5))`,
        [`${TESTABLE}-lcp-${h}`, `${TESTABLE}-s`, TESTABLE, 1500 + h * 40, h],
      );
    }
    // Une seule heure pour l'autre app : rien n'est testable.
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1, $2, $3, '/a', 'LCP', 1800, 'good', now() - interval '2 hours')`,
      [`${VIDE}-lcp`, `${VIDE}-s`, VIDE],
    );

    delete (globalThis as { pgPool?: unknown }).pgPool;
    vi.resetModules();
    process.env.DATABASE_URL = url;
    ({ healthScore } = await import("../../apps/console/lib/health"));
    ({ pool } = await import("../../apps/console/lib/db"));
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await c.end();
  });

  const anomalies = async (app: string) =>
    (await healthScore({ app, period: "7d", device: null, segment: [] })).factors.find((x) => x.key === "anomalies")!;

  it("une route testée sans anomalie : la composante est notée, et dit combien de routes", async () => {
    expect(await anomalies(TESTABLE)).toMatchObject({ earned: 10, detail: "aucune anomalie détectée sur 1 route(s) testable(s)" });
  });

  it("aucune route avec 5 heures de mesures : non testable, hors du score", async () => {
    expect(await anomalies(VIDE)).toMatchObject({
      earned: null,
      raisonNull: "non testable",
      detail: "non testable : 0 route avec 5 heures de mesures LCP sur 8 jours",
    });
  });
});
