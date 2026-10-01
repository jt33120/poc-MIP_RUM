// « Nouvelle release face à la précédente », À MIX DE TRAFIC ÉGAL : la lecture SQL
// (`comparaisonStandardisee`, apps/console/lib/queries-deploys.ts) prouvée contre le
// module pur (`@mip/stats/standardisation`) sur PostgreSQL.
//
// Ce qui peut mentir, c'est la lecture : le p75 pondéré se calcule EN BASE (somme
// cumulée des poids, pour ne pas rapatrier les mesures). On verrouille :
//   - le p75 pondéré SQL est EXACTEMENT celui de `standardiserQuantile` sur les mêmes
//     mesures ;
//   - deux releases au même code (valeur fonction de la seule strate) mais au mix
//     différent : écart brut net, écart à mix égal nul ;
//   - la population : seulement A et B (une troisième release ne compte pas), robots
//     exclus, route d'entrée = première page vue sous la release ;
//   - sous un seuil d'effectif, la ligne se tait et dit pourquoi.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";
import { standardiserPart, standardiserQuantile, type Observation } from "../../packages/stats/src/standardisation";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const APP = "vercomp-sql";
const APP_MAIGRE = "vercomp-sql-maigre";
const APPS = [APP, APP_MAIGRE];
const A = "2.0.0";
const B = "2.1.0";
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
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"])
    await c.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
}

type Strate = "desktop|/accueil" | "desktop|/panier" | "mobile|/accueil" | "mobile|/panier";
/** Le « code » : LCP et INP médians, part de sessions en erreur — fonction de la seule strate. */
const LCP: Record<Strate, number> = { "desktop|/accueil": 1200, "desktop|/panier": 1800, "mobile|/accueil": 2400, "mobile|/panier": 3600 };
const INP: Record<Strate, number> = { "desktop|/accueil": 100, "desktop|/panier": 150, "mobile|/accueil": 200, "mobile|/panier": 300 };
const ERREUR: Record<Strate, number> = { "desktop|/accueil": 0.1, "desktop|/panier": 0.2, "mobile|/accueil": 0.2, "mobile|/panier": 0.4 };
/** Le mix : A servie le jour (ordinateurs, panier), B la nuit (mobiles, accueil). */
const MIX: Record<string, Record<Strate, number>> = {
  [A]: { "desktop|/accueil": 40, "desktop|/panier": 100, "mobile|/accueil": 30, "mobile|/panier": 30 },
  [B]: { "desktop|/accueil": 20, "desktop|/panier": 15, "mobile|/accueil": 120, "mobile|/panier": 45 },
};

interface Ligne {
  app: string;
  session: string;
  release: string;
  appareil: string;
  route: string;
  bot: boolean;
  lcp: number;
  inp: number;
  erreur: boolean;
  quand: Date;
}

/** Une session par ligne : une page vue, un LCP, un INP, une erreur éventuelle. */
function lignes(app: string, release: string, mix: Partial<Record<Strate, number>>, bot = false): Ligne[] {
  const out: Ligne[] = [];
  for (const [s, n] of Object.entries(mix) as [Strate, number][]) {
    const [appareil, route] = s.split("|");
    for (let i = 0; i < n; i++) {
      // Une grille régulière de ±40 % autour de la médiane : la même loi des deux côtés.
      const f = 0.6 + (0.8 * (i + 0.5)) / n;
      out.push({
        app,
        session: `${app}-${release}-${bot ? "bot-" : ""}${s}-${i}`,
        release,
        appareil,
        route,
        bot,
        lcp: bot ? 30_000 : LCP[s] * f,
        inp: bot ? 5_000 : INP[s] * f,
        erreur: bot || i < Math.round(n * ERREUR[s]),
        quand: new Date(DEBUT + HEURE + (out.length % 240) * 60_000),
      });
    }
  }
  return out;
}

async function semer(c: pg.Client, toutes: Ligne[]): Promise<void> {
  const col = <K extends keyof Ligne>(k: K) => toutes.map((l) => l[k]);
  await c.query(
    `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, release)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::bool[], $5::timestamptz[], $5::timestamptz[], $6::text[])`,
    [col("session"), col("app"), col("appareil"), col("bot"), col("quand"), col("release")],
  );
  await c.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, started_at, release)
     select s || '-pv', s, a, r, q, rel from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::text[]) as t(s, a, r, q, rel)`,
    [col("session"), col("app"), col("route"), col("quand"), col("release")],
  );
  for (const [nom, valeurs] of [["LCP", col("lcp")], ["INP", col("inp")]] as const) {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts, release)
       select s || '-' || $6, s, a, r, $6, v, q, rel
         from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::text[], $7::float8[]) as t(s, a, r, q, rel, v)`,
      [col("session"), col("app"), col("route"), col("quand"), col("release"), nom, valeurs],
    );
  }
  const enErreur = toutes.filter((l) => l.erreur);
  await c.query(
    `insert into rum_error (span_id, session_id, app_id, route, kind, message, occurrences, fingerprint, ts, release)
     select s || '-err', s, a, r, 'error', 'vercomp', 3, 'vercomp-fp', q, rel
       from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::text[]) as t(s, a, r, q, rel)`,
    [enErreur.map((l) => l.session), enErreur.map((l) => l.app), enErreur.map((l) => l.route), enErreur.map((l) => l.quand), enErreur.map((l) => l.release)],
  );
}

if (!url) console.warn("[versions-standardisees-sql] SAUTÉ — définir SQL_TEST_DATABASE_URL (base jetable).");

(url ? describe : describe.skip)("releases à mix de trafic égal, sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  const humaines = [...lignes(APP, A, MIX[A]), ...lignes(APP, B, MIX[B])];
  let lib: {
    comparaisonStandardisee: typeof import("../../apps/console/lib/queries-deploys").comparaisonStandardisee;
    filtersOfQuery: typeof import("../../apps/console/lib/filters").filtersOfQuery;
    pool: { end: () => Promise<void> };
  };

  beforeAll(async () => {
    await c.connect();
    for (const f of fichiersSql()) await c.query(readFileSync(f, "utf8"));
    await nettoyer(c);
    await semer(c, [
      ...humaines,
      // Hors population : des robots de B (lents, tous en erreur) et une troisième release.
      ...lignes(APP, B, { "mobile|/panier": 30 }, true),
      ...lignes(APP, "1.9.0", { "desktop|/accueil": 60, "mobile|/panier": 60 }),
      // Une app maigre : 20 sessions par release, sous le seuil de 50.
      ...lignes(APP_MAIGRE, A, { "desktop|/accueil": 20 }),
      ...lignes(APP_MAIGRE, B, { "desktop|/accueil": 20 }),
    ]);
    // Route d'entrée = PREMIÈRE page vue sous la release : une session de B entrée par
    // l'accueil puis passée au panier reste dans la strate « accueil ».
    const entree = humaines.find((l) => l.release === B && l.route === "/accueil" && l.appareil === "desktop")!;
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, release)
       values ($1 || '-pv2', $1, $2, '/panier', $3::timestamptz + interval '5 minutes', $4)`,
      [entree.session, APP, entree.quand, B],
    );
    delete (globalThis as { pgPool?: unknown }).pgPool;
    vi.resetModules();
    process.env.DATABASE_URL = url;
    const { comparaisonStandardisee } = await import("../../apps/console/lib/queries-deploys");
    const { filtersOfQuery } = await import("../../apps/console/lib/filters");
    const { pool } = await import("../../apps/console/lib/db");
    lib = { comparaisonStandardisee, filtersOfQuery, pool };
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  const filtres = (app = APP) => {
    const parsed = parseAnalyticsQuery(new URLSearchParams(`app=${app}&from=${iso(DEBUT)}&to=${iso(FIN)}`), {
      principal: ADMIN,
      nowMs: Date.now(),
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    return lib.filtersOfQuery(parsed.value);
  };

  const observations = (vital: "lcp" | "inp"): Observation[] =>
    humaines.map((l) => ({ cote: l.release === A ? "a" : "b", strate: `${l.route}|${l.appareil}`, valeur: l[vital] }));

  it("le p75 pondéré SQL est exactement celui du module, et l'écart à mix égal est nul quand seul le mix diffère", async () => {
    const r = await lib.comparaisonStandardisee(filtres(), A, B);
    expect(r.disponible).toBe(true);
    if (!r.disponible) return;
    for (const vital of ["lcp", "inp"] as const) {
      const attendu = standardiserQuantile(observations(vital));
      expect(attendu.ok).toBe(true);
      if (!attendu.ok) continue;
      const ligne = r[vital];
      expect(ligne).toMatchObject({ ok: true, a: attendu.a, b: attendu.b });
      if (!ligne.ok) continue;
      // Robots et troisième release hors population : 200 mesures de chaque côté, 4 strates.
      expect(ligne.effectifs).toEqual({ a: 200, b: 200 });
      expect(ligne.strates).toEqual({ communes: 4, total: 4 });
      expect(ligne.couverture).toEqual({ a: 1, b: 1, ensemble: 1 });
      // Brut : B (nuit, mobiles) paraît plus lente de plus de 20 % ; à mix égal, moins de 3 %.
      expect(Math.abs((attendu.brut.b! - attendu.brut.a!) / attendu.brut.a!)).toBeGreaterThan(0.2);
      expect(Math.abs((ligne.b - ligne.a) / ligne.a)).toBeLessThan(0.03);
    }
  });

  it("part de sessions en erreur : sessions de la release, robots exclus, route d'entrée = première page vue", async () => {
    const r = await lib.comparaisonStandardisee(filtres(), A, B);
    if (!r.disponible) throw new Error(r.raison);
    const k = (rel: string, s: Strate) => Math.round(MIX[rel][s] * ERREUR[s]);
    const attendu = standardiserPart(
      (Object.keys(LCP) as Strate[]).map((s) => {
        const [appareil, route] = s.split("|");
        return { strate: `${route}\u0000${appareil}`, a: { n: MIX[A][s], k: k(A, s) }, b: { n: MIX[B][s], k: k(B, s) } };
      }),
    );
    expect(attendu.ok).toBe(true);
    if (!attendu.ok) return;
    expect(r.erreurs).toMatchObject({ ok: true, effectifs: { a: 200, b: 200 }, strates: { communes: 4, total: 4 } });
    if (!r.erreurs.ok) return;
    expect(r.erreurs.a).toBeCloseTo(attendu.a, 12);
    expect(r.erreurs.b).toBeCloseTo(attendu.b, 12);
    // Brut : 21 % contre 23,5 % ; à mix égal, la même part (même taux par strate).
    expect(attendu.brut).toEqual({ a: 42 / 200, b: 47 / 200 });
    expect(r.erreurs.b).toBeCloseTo(r.erreurs.a, 12);
    expect(r.couvertureSessions).toEqual({ a: 1, b: 1, ensemble: 1 });
  });

  it("sous le seuil d'effectif, chaque ligne se tait et dit pourquoi", async () => {
    const r = await lib.comparaisonStandardisee(filtres(APP_MAIGRE), A, B);
    if (!r.disponible) throw new Error(r.raison);
    expect(r.lcp).toEqual({ ok: false, raison: "20 mesures de A dans des strates communes, 50 requises" });
    expect(r.inp).toEqual({ ok: false, raison: "20 mesures de A dans des strates communes, 50 requises" });
    expect(r.erreurs).toEqual({ ok: false, raison: "20 sessions de A dans des strates communes, 50 requises" });
  });
});
