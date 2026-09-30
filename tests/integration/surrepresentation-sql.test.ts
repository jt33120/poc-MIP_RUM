// Les effectifs de `GET /api/v1/errors/{fingerprint}/overrepresentation`
// (`apps/console/lib/queries-surrepresentation.ts`), prouvés sur PostgreSQL.
//
// Pourquoi une base réelle. Le test de Fisher du paquet est exact ; ce qui peut
// mentir, ce sont ses effectifs. Ici on verrouille la POPULATION (RM6) :
//   - une session touchée compte UNE fois, quel que soit son nombre d'occurrences ;
//   - une occurrence hors de la fenêtre, d'une autre empreinte ou d'une AUTRE app
//     (même identifiant de session) ne touche rien ;
//   - une session de robot sort de la base ET des touchées (touchées ⊂ base) ;
//   - une session inactive sur la fenêtre n'est pas dans la base ;
//   - une valeur absente vaut « Inconnu ».
//
// Base jetable : SQL_TEST_DATABASE_URL (schéma courant appliqué ici).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../../apps/console/lib/filters";
import { analyserSurrepresentation, UNITES_SESSIONS } from "../../packages/stats/src/surrepresentation";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A = "surrep-sql-a";
const B = "surrep-sql-b";
const APPS = [A, B];
const EMPREINTE = "surrep-fp-1";

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of ["rum_error", "rum_session", "app_registry"])
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
}

async function semer(c: pg.Client): Promise<void> {
  await c.query("begin");
  try {
    await c.query(
      `insert into app_registry (app_id, name, active, internal)
       select app, app, true, false from unnest($1::text[]) as app
       on conflict (app_id) do update set active = true, internal = false`,
      [APPS],
    );
    const session = (app: string, id: string, browser: string | null, { bot = false, vu = "now() - interval '1 hour'" } = {}) =>
      c.query(
        `insert into rum_session (session_id, app_id, device_type, browser, os, is_bot, sample_rate, error_sample_rate, started_at, last_seen_at)
         values ($1, $2, 'desktop', $3, 'macOS', $4, 1, 1, ${vu} - interval '10 minutes', ${vu})`,
        [id, app, browser, bot],
      );
    let n = 0;
    const erreur = (app: string, sessionId: string, empreinte: string, quand = "now() - interval '2 hours'", occurrences = 1) =>
      c.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, occurrences, fingerprint, ts)
         values ($1, $2, $3, '/', 'error', 'surrep', $4, $5, ${quand})`,
        [`surrep-e-${++n}`, sessionId, app, occurrences, empreinte],
      );
    // Base de A : 12 sessions Safari, 28 Chrome, une sans navigateur (NULL : v75 refuse la chaîne vide).
    for (let i = 1; i <= 12; i++) await session(A, `sa-${i}`, "Safari");
    for (let i = 13; i <= 40; i++) await session(A, `sa-${i}`, "Chrome");
    await session(A, "sa-vide", null);
    // Hors base : un robot (touché), une session inactive depuis trois jours (touchée hors fenêtre).
    await session(A, "sa-robot", "Safari", { bot: true });
    await session(A, "sa-ancienne", "Safari", { vu: "now() - interval '3 days'" });
    // Touchées : 9 Safari (sa-1 : cinquante occurrences, UNE session), 3 Chrome.
    for (let i = 1; i <= 9; i++) await erreur(A, `sa-${i}`, EMPREINTE, undefined, i === 1 ? 50 : 1);
    await erreur(A, "sa-1", EMPREINTE);
    for (let i = 13; i <= 15; i++) await erreur(A, `sa-${i}`, EMPREINTE);
    await erreur(A, "sa-robot", EMPREINTE);
    // Ne touchent rien : une autre empreinte, une occurrence hors fenêtre, la même
    // empreinte dans l'app B, citant un identifiant de session de A (une occurrence
    // porte l'identifiant que son émetteur déclare : celle de B ne touche pas A).
    await erreur(A, "sa-20", "surrep-autre");
    await erreur(A, "sa-21", EMPREINTE, "now() - interval '30 hours'");
    await erreur(B, "sa-22", EMPREINTE);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const lecture = await import("../../apps/console/lib/queries-surrepresentation");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...lecture, pool };
}

const filtres = (app = A): Filters => ({
  app,
  period: "24h",
  device: null,
  segment: [],
  includeBots: false,
  includeInternal: false,
});

(url ? describe : describe.skip)("effectifs d'un groupe d'erreurs sur PostgreSQL (sur-représentation)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Awaited<ReturnType<typeof consoleSur>>;

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c);
    lib = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("base et touchées : des SESSIONS de l'app, actives sur la fenêtre, robots exclus", async () => {
    const e = await lib.effectifsDuGroupe({ app_id: A, fingerprint: EMPREINTE }, filtres());
    // 41 sessions actives et humaines ; 12 touchées (sa-1 une seule fois ; ni le robot,
    // ni l'occurrence d'avant-hier, ni celle de B sur « sa-22 »).
    expect(e.totaux).toEqual({ touches: 12, base: 41 });
  });

  it("par navigateur : les effectifs de chaque valeur, « Inconnu » pour une valeur absente", async () => {
    const e = await lib.effectifsDuGroupe({ app_id: A, fingerprint: EMPREINTE }, filtres());
    const navigateur = e.dimensions.find((d) => d.cle === "browser");
    expect(navigateur?.valeurs).toEqual([
      { valeur: "Safari", nTouches: 9, nBase: 12 },
      { valeur: "Chrome", nTouches: 3, nBase: 28 },
      { valeur: "Inconnu", nTouches: 0, nBase: 1 },
    ]);
    // Une dimension où toutes les sessions partagent la valeur : une seule ligne.
    expect(e.dimensions.find((d) => d.cle === "os")?.valeurs).toEqual([{ valeur: "macOS", nTouches: 12, nBase: 41 }]);
  });

  it("le paquet en tire une analyse : Safari retenu, sur ces effectifs-là", async () => {
    const e = await lib.effectifsDuGroupe({ app_id: A, fingerprint: EMPREINTE }, filtres());
    const analyse = analyserSurrepresentation(e.dimensions, e.totaux, UNITES_SESSIONS);
    expect(analyse.ok && analyse.retenues.map((r) => `${r.cle}:${r.valeur}`)).toEqual(["browser:Safari"]);
  });

  it("les robots demandés rejoignent la base ET les touchées", async () => {
    const e = await lib.effectifsDuGroupe({ app_id: A, fingerprint: EMPREINTE }, { ...filtres(), includeBots: true });
    expect(e.totaux).toEqual({ touches: 13, base: 42 });
  });
});
