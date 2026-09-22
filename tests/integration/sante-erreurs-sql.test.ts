// F11 — composante « Erreurs navigateur » du score de santé, sur un vrai PostgreSQL.
//
// Ce que seule la base peut dire (CP14) : une exception Node sans session et une
// occurrence sans source déclarée n'entrent PAS au numérateur du facteur ; seules
// les sources `browser_*` y sont, divisées par les pages vues de la même fenêtre ;
// sans page vue, la composante sort du score au lieu de valoir 0.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const AVEC_VUES = "f11-sante-vues";
const SANS_VUE = "f11-sante-sans-vue";
const APPS = [AVEC_VUES, SANS_VUE];

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
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
  }
}

if (!url) console.warn("[sante-erreurs-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

(url ? describe : describe.skip)("facteur « Erreurs navigateur » du score de santé (F11, CP14)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let healthScore: typeof import("../../apps/console/lib/health").healthScore;
  let pool: { end: () => Promise<void> };

  beforeAll(async () => {
    await c.connect();
    for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    await nettoyer(c);
    for (const app of APPS) {
      await c.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
      await c.query(
        `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at)
         values ($1, $2, 'desktop', false, now() - interval '2 hours', now() - interval '20 minutes')`,
        [`${app}-s`, app],
      );
    }
    // Quatre pages vues dans la dernière heure, pour la seule app AVEC_VUES.
    for (let i = 0; i < 4; i++) {
      await c.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
         values ($1, $2, $3, '/a', now() - interval '30 minutes')`,
        [`${AVEC_VUES}-pv${i}`, `${AVEC_VUES}-s`, AVEC_VUES],
      );
    }
    const erreurs: [string, string | null, string, string | null, number][] = [
      [`${AVEC_VUES}-e-nav`, `${AVEC_VUES}-s`, AVEC_VUES, "browser_js", 2], // au numérateur
      [`${AVEC_VUES}-e-node`, null, AVEC_VUES, "node", 5], // backend, sans session : hors numérateur
      [`${AVEC_VUES}-e-nul`, null, AVEC_VUES, null, 3], // source non déclarée : hors numérateur
      [`${SANS_VUE}-e-nav`, `${SANS_VUE}-s`, SANS_VUE, "browser_js", 4], // des erreurs, aucune vue
    ];
    for (const [span, sid, app, source, occ] of erreurs) {
      await c.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type,
                                fingerprint, occurrences, error_source, ts)
         values ($1, $2, $3, '/a', 'error', 'boom', 'Error', $1, $4, $5, now() - interval '25 minutes')`,
        [span, sid, app, occ, source],
      );
    }

    delete (globalThis as { pgPool?: unknown }).pgPool;
    vi.resetModules();
    process.env.DATABASE_URL = url;
    ({ healthScore } = await import("../../apps/console/lib/health"));
    ({ pool } = await import("../../apps/console/lib/db"));
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await nettoyer(c);
    await c.end();
  });

  const erreursDe = async (app: string) =>
    (await healthScore({ app, period: "24h", device: null, segment: [] })).factors.find((x) => x.key === "errors")!;

  it("seules les occurrences navigateur entrent au numérateur (node et sans source exclues)", async () => {
    const f = await erreursDe(AVEC_VUES);
    expect(f.label).toBe("Erreurs navigateur");
    expect(f.detail.replace(/[  ]/g, " ")).toBe("2 occurrence(s) pour 4 page(s) vue(s) (50 pour 100)");
    expect(f.earned).toBe(15); // 30 × (1 − 2 / 4)
  });

  it("des erreurs mais aucune page vue : la composante sort du score, elle ne vaut pas 0", async () => {
    const f = await erreursDe(SANS_VUE);
    expect(f.earned).toBeNull();
    expect(f.detail).toBe("aucune page vue : ratio non calculable");
  });
});
