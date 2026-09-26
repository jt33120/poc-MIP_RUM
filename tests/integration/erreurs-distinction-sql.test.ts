// Ce qui distingue deux groupes d'erreurs de même titre (recette du 26/09/2026),
// prouvé sur PostgreSQL : `distinctionsDesGroupes` lit, sur la même base filtrée
// que la liste, la pile du dernier exemplaire qui en porte une (ou, à défaut, le
// fichier et la ligne) et la route qui porte le plus d'occurrences — sommées (V1),
// jamais comptées en lignes.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ErrorFilters } from "../../apps/console/lib/queries-errors";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const APP = "distinction-sql-app";
const AUTRE = "distinction-sql-autre";

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
  for (const table of ["rum_error", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [[APP, AUTRE]]);
  }
}

/** [empreinte, route, pile, source, ligne, occurrences, minutes avant maintenant] */
type Ligne = [string, string | null, string | null, string | null, number | null, number, number];

const LIGNES: Ligne[] = [
  // Groupe 1 : /a a plus de LIGNES (3) que /b (1), mais /b porte plus d'OCCURRENCES
  // (5 contre 3) : la somme décide. La ligne la plus récente n'a pas de pile : c'est
  // la dernière qui en porte une qui est lue.
  ["dist-fp1", "/a", "Error: x\n    at ancienne (https://s.fr/app.js:1:1)", null, null, 1, 30],
  ["dist-fp1", "/a", null, null, null, 1, 25],
  ["dist-fp1", "/b", "Error: x\n    at recente (https://s.fr/app.js:42:7)", null, null, 5, 10],
  ["dist-fp1", "/a", null, null, null, 1, 5],
  // Groupe 2 : pas de pile, un fichier et une ligne déclarés ; une seule route.
  ["dist-fp2", "/c", null, "https://s.fr/js/vendor.js?v=1", 12, 1, 5],
  // Groupe 3 : route inconnue sur toutes ses lignes, ni pile ni fichier.
  ["dist-fp3", null, null, null, null, 2, 5],
];

(url ? describe : describe.skip)("distinctionsDesGroupes sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: typeof import("../../apps/console/lib/queries-errors");
  let pool: pg.Pool;

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await c.query(
      `insert into app_registry (app_id, name, active, internal) values ($1, $1, true, false), ($2, $2, true, false)
       on conflict (app_id) do update set active = true, internal = false`,
      [APP, AUTRE],
    );
    for (const [fp, route, pile, source, ligne, occ, minutes] of LIGNES) {
      await c.query(
        `insert into rum_error (app_id, fingerprint, route, stack, source, lineno, occurrences, error_type, message, kind, ts)
         values ($1, $2, $3, $4, $5, $6, $7, 'Error', 'même titre', 'error', now() - make_interval(mins => $8))`,
        [APP, fp, route, pile, source, ligne, occ, minutes],
      );
    }
    // La même empreinte dans une autre app : elle ne doit rien prêter au groupe demandé.
    await c.query(
      `insert into rum_error (app_id, fingerprint, route, stack, occurrences, error_type, message, kind, ts)
       values ($1, 'dist-fp1', '/autre', 'Error: y\n    at etrangere (https://o.fr/o.js:9:9)', 50, 'Error', 'même titre', 'error', now())`,
      [AUTRE],
    );
    delete (globalThis as { pgPool?: unknown }).pgPool;
    vi.resetModules();
    process.env.DATABASE_URL = url;
    lib = await import("../../apps/console/lib/queries-errors");
    pool = (await import("../../apps/console/lib/db")).pool;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await nettoyer(c);
    await c.end();
  });

  const filtres: ErrorFilters = {
    app: APP,
    period: "24h",
    device: null,
    segment: [],
    includeBots: true,
    includeInternal: false,
  };

  it("pile du dernier exemplaire qui en porte une, route principale par occurrences sommées", async () => {
    const d = await lib.distinctionsDesGroupes(filtres, [
      { app_id: APP, fingerprint: "dist-fp1" },
      { app_id: APP, fingerprint: "dist-fp2" },
      { app_id: APP, fingerprint: "dist-fp3" },
    ]);
    const g1 = d[`${APP}\u0000dist-fp1`];
    expect(g1.pile).toContain("recente");
    expect(g1.route).toBe("/b");
    expect(g1.partRoute).toBeCloseTo(5 / 8, 5);
    // L'autre app ne prête ni sa pile ni sa route.
    expect(g1.pile).not.toContain("etrangere");

    const g2 = d[`${APP}\u0000dist-fp2`];
    expect(g2).toMatchObject({ pile: null, fichier: "https://s.fr/js/vendor.js?v=1", ligne: 12, route: "/c", partRoute: 1 });

    // Route inconnue partout : aucune route « principale » inventée.
    const g3 = d[`${APP}\u0000dist-fp3`];
    expect(g3).toMatchObject({ pile: null, fichier: null, route: null, partRoute: null });
  });

  it("aucun groupe demandé : aucune lecture", async () => {
    expect(await lib.distinctionsDesGroupes(filtres, [])).toEqual({});
  });
});
