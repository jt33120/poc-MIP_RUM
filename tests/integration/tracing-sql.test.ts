// F59 — les lectures de l'écran Tracing, prouvées sur PostgreSQL.
//
// Pourquoi une base réelle. Ce qui compte ici ne se voit pas dans la forme du
// SQL : qu'une médiane de rapports vaille 0,5 et non le rapport des p75 ; que le
// trajet soit un p75 de différences et non une différence de p75 ; que
// `greatest(null, 0)` — qui vaut 0 en PostgreSQL, pas NULL — ne transforme pas un
// appel non suivi en « 0 ms de trajet » ; qu'un seau vide reste un trou ; qu'un
// trace_id partagé par deux tenants ne prête ni jumeau serveur ni erreur à
// l'autre. Seul PostgreSQL le dit.
//
// Base jetable : SQL_TEST_DATABASE_URL (schéma courant).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryOf, type FiltersLike } from "../../apps/console/lib/filters";
import { bucketStarts } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "f59-app-a";
const B = "f59-app-b";
const APPS = [A, B];

const trace = (n: number) => n.toString(16).padStart(32, "a");
const span = (n: number) => n.toString(16).padStart(16, "c");

interface Span {
  id: string;
  trace: string;
  tier: "front" | "back";
  app: string;
  session: string | null;
  method: string | null;
  url: string | null;
  status: number | null;
  ms: number;
  /** Minutes avant l'instant du semis. */
  avant: number;
}

// Les appels front de A sont espacés de 7 minutes : chacun tombe dans son propre
// seau de 5 minutes, quel que soit l'alignement de l'horloge au moment du test.
const F1 = span(1);
const B1_AUTRE_TENANT = span(101);
const SPANS: Span[] = [
  // « GET /api/median » : le cas du plan (front 100 / back 90, front 1 000 / back 100) → part 0,5.
  // F1 porte l'URL absolue, F2 le chemin seul : l'origine retirée, ils forment UN appel.
  { id: F1, trace: trace(1), tier: "front", app: A, session: "f59-sa", method: "GET", url: "https://app.example/api/median", status: 200, ms: 100, avant: 8 },
  { id: span(11), trace: trace(1), tier: "back", app: A, session: null, method: "GET", url: null, status: 200, ms: 90, avant: 8 },
  // Même trace_id émis chez B : jamais le jumeau de F1.
  { id: B1_AUTRE_TENANT, trace: trace(1), tier: "back", app: B, session: null, method: "GET", url: null, status: 200, ms: 5, avant: 8 },
  { id: span(2), trace: trace(2), tier: "front", app: A, session: "f59-sa", method: "GET", url: "/api/median", status: 200, ms: 1000, avant: 15 },
  { id: span(12), trace: trace(2), tier: "back", app: A, session: null, method: "GET", url: null, status: 200, ms: 100, avant: 15 },
  // « POST /api/trajet » : p75 du trajet ≠ front_p75 − back_p75, un appel non suivi, un échec 500, un statut 0.
  { id: span(3), trace: trace(3), tier: "front", app: A, session: "f59-sa", method: "POST", url: "/api/trajet", status: 500, ms: 1000, avant: 22 },
  { id: span(13), trace: trace(3), tier: "back", app: A, session: null, method: "POST", url: null, status: 500, ms: 900, avant: 22 },
  { id: span(4), trace: trace(4), tier: "front", app: A, session: "f59-sa", method: "POST", url: "/api/trajet", status: 200, ms: 500, avant: 29 },
  { id: span(14), trace: trace(4), tier: "back", app: A, session: null, method: "POST", url: null, status: 200, ms: 50, avant: 29 },
  { id: span(5), trace: trace(5), tier: "front", app: A, session: "f59-sa", method: "POST", url: "/api/trajet", status: 0, ms: 300, avant: 36 },
  // « GET /api/skew » : serveur plus long que le navigateur (horloges) → part bornée à 1, trajet borné à 0.
  { id: span(6), trace: trace(6), tier: "front", app: A, session: "f59-sa", method: "GET", url: "/api/skew", status: 200, ms: 100, avant: 43 },
  { id: span(16), trace: trace(6), tier: "back", app: A, session: null, method: "GET", url: null, status: 200, ms: 150, avant: 43 },
  // Robot : exclu par défaut.
  { id: span(7), trace: trace(7), tier: "front", app: A, session: "f59-sa-bot", method: "GET", url: "/api/bot", status: 200, ms: 5000, avant: 57 },
  // Autre tenant, même appel : jamais lu depuis A.
  { id: span(8), trace: trace(8), tier: "front", app: B, session: "f59-sb", method: "GET", url: "/api/median", status: 200, ms: 2000, avant: 8 },
];
// « GET /api/volume » : 30 appels rapides, non suivis — premier du classement malgré un p75 de 10 ms.
for (let i = 0; i < 30; i++) {
  SPANS.push({
    id: span(1000 + i), trace: trace(1000 + i), tier: "front", app: A, session: "f59-sa",
    method: "GET", url: "/api/volume", status: 200, ms: 10, avant: 50,
  });
}

interface Erreur {
  app: string;
  fingerprint: string | null;
  trace: string | null;
  parent: string | null;
  occurrences: number;
  message: string;
  avant: number;
}

const ERREURS: Erreur[] = [
  // Récente, parent cité mais chez B : invérifiable dans A, donc pas de lien.
  { app: A, fingerprint: "f59fp-a1", trace: trace(1), parent: B1_AUTRE_TENANT, occurrences: 3, message: "boom récent", avant: 5 },
  // Plus ancienne, parent F1 vérifié (même app, même trace) : c'est lui le lien.
  { app: A, fingerprint: "f59fp-a1", trace: trace(1), parent: F1, occurrences: 4, message: "boom ancien", avant: 6 },
  { app: A, fingerprint: "f59fp-a2", trace: trace(1), parent: "ffffffffffffffff", occurrences: 1, message: "span inconnu", avant: 7 },
  { app: B, fingerprint: "f59fp-b1", trace: trace(1), parent: B1_AUTRE_TENANT, occurrences: 5, message: "chez B", avant: 5 },
  { app: A, fingerprint: null, trace: trace(1), parent: null, occurrences: 2, message: "sans empreinte", avant: 5 },
  { app: A, fingerprint: "f59fp-a3", trace: trace(2), parent: null, occurrences: 9, message: "autre trace", avant: 5 },
];

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of ["rum_error", "rum_span", "rum_session", "app_registry"])
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
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, sample_rate, error_sample_rate)
       values ('f59-sa', $1, 'desktop', false, 1, 1),
              ('f59-sa-bot', $1, 'desktop', true, 1, 1),
              ('f59-sb', $2, 'desktop', false, 1, 1)`,
      [A, B],
    );
    // Une transaction = une horloge : tous les décalages partent du même now().
    for (const s of SPANS) {
      await c.query(
        `insert into rum_span (span_id, trace_id, tier, app_id, session_id, method, url, status_code, duration_ms, ts)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - $10::int * interval '1 minute')`,
        [s.id, s.trace, s.tier, s.app, s.session, s.method, s.url, s.status, s.ms, s.avant],
      );
    }
    for (const e of ERREURS) {
      await c.query(
        `insert into rum_error (app_id, fingerprint, trace_id, source_parent_span_id, occurrences, message, kind, ts)
         values ($1, $2, $3, $4, $5, $6, 'error', now() - $7::int * interval '1 minute')`,
        [e.app, e.fingerprint, e.trace, e.parent, e.occurrences, e.message, e.avant],
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

/** Modules console branchés sur la base jetable (db.ts lit DATABASE_URL à l'évaluation). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const tracing = await import("../../apps/console/lib/queries-tracing");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...tracing, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const filtres = (over: Partial<FiltersLike> = {}): FiltersLike => ({
  app: A,
  period: "24h",
  device: null,
  segment: [],
  includeBots: false,
  includeInternal: false,
  ...over,
});

(url ? describe : describe.skip)("lectures Tracing F59 sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

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

  describe("apiCallsDecomposition — T6 / T8", () => {
    it("part serveur = médiane des rapports appel par appel : (100/90, 1 000/100) → 0,5", async () => {
      const lignes = await lib.apiCallsDecomposition(filtres());
      const median = lignes.find((l) => l.url === "/api/median")!;
      // F1 (URL absolue) et F2 (chemin) : un seul appel. Le 5 ms de B sur la même trace n'est pas un jumeau.
      expect(median).toMatchObject({ method: "GET", n: 2, n_suivis: 2, front_p75: 775, back_p75: 97.5, err: 0 });
      expect(median.part_serveur_p50).toBeCloseTo(0.5, 12);
    });

    it("p75 du trajet calculé par trace, jamais front_p75 − back_p75 ; un appel non suivi n'y compte pas pour 0", async () => {
      const lignes = await lib.apiCallsDecomposition(filtres());
      const trajet = lignes.find((l) => l.url === "/api/trajet")!;
      expect(trajet).toMatchObject({ method: "POST", n: 3, n_suivis: 2, front_p75: 750, back_p75: 687.5 });
      // Trajets par trace : 100 et 450 → p75 362,5. La différence des p75 dirait 62,5.
      expect(trajet.reseau_p75).toBe(362.5);
      expect(trajet.reseau_p75).not.toBe(trajet.front_p75! - trajet.back_p75!);
      // Sans le `case`, greatest(null, 0) = 0 ferait entrer l'appel non suivi : p75 {0, 100, 450} = 275, médiane 0,1.
      expect(trajet.part_serveur_p50).toBeCloseTo(0.5, 12);
    });

    it("un appel au statut 0 compte comme échec, comme un 500", async () => {
      const trajet = (await lib.apiCallsDecomposition(filtres())).find((l) => l.url === "/api/trajet")!;
      expect(trajet.err).toBe(2);
    });

    it("serveur plus long que le navigateur : part bornée à 1, trajet borné à 0", async () => {
      const skew = (await lib.apiCallsDecomposition(filtres())).find((l) => l.url === "/api/skew")!;
      expect(skew).toMatchObject({ n: 1, n_suivis: 1, front_p75: 100, back_p75: 150, reseau_p75: 0, part_serveur_p50: 1 });
    });

    it("aucun appel suivi : back, trajet et part sont null, jamais 0", async () => {
      const volume = (await lib.apiCallsDecomposition(filtres())).find((l) => l.url === "/api/volume")!;
      expect(volume).toEqual({
        url: "/api/volume", method: "GET", n: 30, n_suivis: 0, front_p75: 10,
        back_p75: null, reseau_p75: null, part_serveur_p50: null, err: 0,
      });
    });

    it("gravité : au moins 30 appels d'abord, puis front_p75 décroissant ; robots et autre tenant exclus", async () => {
      const lignes = await lib.apiCallsDecomposition(filtres());
      expect(lignes.map((l) => `${l.method} ${l.url}`)).toEqual([
        "GET /api/volume", "GET /api/median", "POST /api/trajet", "GET /api/skew",
      ]);
      const avecRobots = await lib.apiCallsDecomposition(filtres({ includeBots: true }));
      expect(avecRobots.map((l) => l.url)).toContain("/api/bot");
    });

    it("T1 : le total de traceCoverage égale la somme des n (moins de 50 lignes) ; err et suivis concordent", async () => {
      const [couverture, lignes] = await Promise.all([lib.traceCoverage(filtres()), lib.apiCallsDecomposition(filtres())]);
      expect(lignes.length).toBeLessThan(50);
      expect(couverture.total).toBe(36);
      expect(couverture.total).toBe(lignes.reduce((s, l) => s + l.n, 0));
      expect(couverture.correlated).toBe(lignes.reduce((s, l) => s + l.n_suivis, 0));
      // T5 : F3 (500) et F5 (statut 0).
      expect(couverture.err).toBe(2);
      expect(couverture.err).toBe(lignes.reduce((s, l) => s + l.err, 0));
    });

    it("B lit ses seuls appels", async () => {
      const lignes = await lib.apiCallsDecomposition(filtres({ app: B }));
      expect(lignes).toEqual([expect.objectContaining({ url: "/api/median", n: 1, n_suivis: 0, front_p75: 2000 })]);
    });
  });

  describe("spanLatencySeries — T7", () => {
    it("tous les seaux du contrat ; un seau vide vaut null (un trou), avec n = 0", async () => {
      const base = filtres({ period: "1h" });
      const query = queryOf(base);
      const points = await lib.spanLatencySeries({ ...base, query });
      expect(points.map((p) => p.t)).toEqual(bucketStarts(query.range).map((ms) => new Date(ms).toISOString()));
      expect(points.reduce((s, p) => s + p.n, 0)).toBe(36);
      const pleins = points.filter((p) => p.n > 0);
      const vides = points.filter((p) => p.n === 0);
      expect(pleins).toHaveLength(7);
      expect(vides.length).toBeGreaterThanOrEqual(5);
      for (const p of vides) expect(p).toMatchObject({ front_p75: null, back_p75: null });
      // Serveur : seulement les appels suivis du seau.
      expect(pleins.find((p) => p.n === 30)).toMatchObject({ front_p75: 10, back_p75: null });
      expect(pleins.find((p) => p.front_p75 === 300)).toMatchObject({ n: 1, back_p75: null });
      expect(pleins.find((p) => p.back_p75 === 90)).toMatchObject({ n: 1, front_p75: 100 });
    });
  });

  describe("slowTraces(f, { appel }) — T9", () => {
    it("sans filtre : les 20 plus lents de A, sans robot ni autre tenant", async () => {
      const lignes = await lib.slowTraces(filtres());
      expect(lignes).toHaveLength(20);
      expect(lignes[0].front_ms).toBe(1000);
      expect(lignes.some((l) => l.url === "/api/bot" || l.front_ms === 2000)).toBe(false);
    });

    it("avec `appel` : seulement cet appel, trajet par trace, non suivi → null", async () => {
      const lignes = await lib.slowTraces(filtres(), { appel: { method: "POST", url: "/api/trajet" } });
      expect(lignes.map((l) => [l.method, l.url, l.front_ms, l.back_ms, l.network_ms])).toEqual([
        ["POST", "/api/trajet", 1000, 900, 100],
        ["POST", "/api/trajet", 500, 50, 450],
        ["POST", "/api/trajet", 300, null, null],
      ]);
    });

    it("même expression de chemin que le regroupement : l'URL absolue est retrouvée par son chemin", async () => {
      const lignes = await lib.slowTraces(filtres(), { appel: { method: "GET", url: "/api/median" } });
      expect(lignes.map((l) => l.trace_id).sort()).toEqual([trace(1), trace(2)].sort());
    });

    it.each([
      ["autre méthode", { method: "POST", url: "/api/median" }],
      ["URL avec origine (le paramètre porte le chemin seul)", { method: "GET", url: "https://app.example/api/median" }],
      ["valeur hostile, liée et non interprétée", { method: "GET", url: "' or 1=1 --" }],
    ])("%s → aucune ligne", async (_cas, appel) => {
      await expect(lib.slowTraces(filtres(), { appel })).resolves.toEqual([]);
    });
  });

  describe("errorsOfTrace — TD4", () => {
    it("A : groupes de A seulement, sum(occurrences), message le plus récent, parent vérifié dans l'app", async () => {
      await expect(lib.errorsOfTrace(trace(1), { apps: [A] })).resolves.toEqual([
        { app_id: A, fingerprint: "f59fp-a1", message: "boom récent", occurrences: 7, source_parent_span_id: F1 },
        { app_id: A, fingerprint: "f59fp-a2", message: "span inconnu", occurrences: 1, source_parent_span_id: null },
      ]);
    });

    it("trace partagée : B ne voit que son erreur, et A jamais celle de B", async () => {
      await expect(lib.errorsOfTrace(trace(1), { apps: [B] })).resolves.toEqual([
        { app_id: B, fingerprint: "f59fp-b1", message: "chez B", occurrences: 5, source_parent_span_id: B1_AUTRE_TENANT },
      ]);
    });

    it("apps = [] → aucune ligne ; null (sans restriction) → les deux apps", async () => {
      await expect(lib.errorsOfTrace(trace(1), { apps: [] })).resolves.toEqual([]);
      const toutes = await lib.errorsOfTrace(trace(1), { apps: null });
      expect(toutes.map((e) => [e.app_id, e.fingerprint, e.occurrences])).toEqual([
        [A, "f59fp-a1", 7], [B, "f59fp-b1", 5], [A, "f59fp-a2", 1],
      ]);
    });

    it("trace inconnue → aucune ligne", async () => {
      await expect(lib.errorsOfTrace(trace(999), { apps: null })).resolves.toEqual([]);
    });
  });
});
