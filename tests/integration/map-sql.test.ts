// F52 — les lectures de la Carte d'expérience, prouvées sur PostgreSQL.
//
// POURQUOI UNE BASE RÉELLE. Le défaut corrigé ici ne se voit pas dans la forme du
// SQL : `mapEdges` joignait le navigateur et le serveur sur le SEUL `trace_id`.
// Depuis E0, tous les appels d'une page vue partagent la trace de la vue, et le
// `route` d'un span front est la route courante AU MOMENT DE L'ÉMISSION (fin de
// l'appel). La jointure faisait donc le produit cartésien des appels et des
// réponses d'une même trace — et, quand un appel se terminait après une navigation
// SPA, elle rattachait sa réponse serveur à la mauvaise vue. Seul PostgreSQL, sur
// une trace à deux appels, montre la différence entre 2 arêtes et 4.
//
// On y prouve aussi B37 (`mapNodeSerie`) : la grille complète des seaux, un seau
// vide à 0 appel et p75 `null` (un trou, jamais 0 ms), et le périmètre d'app.
//
// Base jetable : SQL_TEST_DATABASE_URL (schéma courant).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryOf, type FiltersLike } from "../../apps/console/lib/filters";
import { bucketStarts } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A = "f52-app-a";
const B = "f52-app-b";
const APPS = [A, B];

const trace = (n: number) => n.toString(16).padStart(32, "e");
const span = (n: number) => n.toString(16).padStart(16, "d");

// Spans de A : deux traces de page vue, chacune portant PLUSIEURS appels (E0).
const F1 = span(1); // /panier → /api/panier
const F2 = span(2); // /panier → /api/stock
const F3 = span(3); // appel lancé sur /panier, RENDU après la navigation SPA : route /paiement
const F4 = span(4); // /panier → /api/panier (seconde occurrence)

interface Span {
  id: string;
  trace: string;
  tier: "front" | "back";
  app: string;
  session: string | null;
  route: string;
  ms: number;
  /** Minutes avant l'instant du semis. */
  avant: number;
  parent?: string;
}

const SPANS: Span[] = [
  // Trace 1 : une vue /panier, deux appels, deux réponses serveur.
  { id: F1, trace: trace(1), tier: "front", app: A, session: "f52-sa", route: "/panier", ms: 100, avant: 10 },
  { id: span(11), trace: trace(1), tier: "back", app: A, session: null, route: "/api/panier", ms: 90, avant: 10, parent: F1 },
  { id: F2, trace: trace(1), tier: "front", app: A, session: "f52-sa", route: "/panier", ms: 200, avant: 10 },
  { id: span(12), trace: trace(1), tier: "back", app: A, session: null, route: "/api/stock", ms: 180, avant: 10, parent: F2 },
  // Trace 2 : la MÊME trace porte un appel dont la réponse est arrivée après la
  // navigation SPA (route /paiement) et un appel resté sur /panier.
  { id: F3, trace: trace(2), tier: "front", app: A, session: "f52-sa", route: "/paiement", ms: 300, avant: 12 },
  { id: span(13), trace: trace(2), tier: "back", app: A, session: null, route: "/api/paiement", ms: 280, avant: 12, parent: F3 },
  { id: F4, trace: trace(2), tier: "front", app: A, session: "f52-sa", route: "/panier", ms: 120, avant: 12 },
  { id: span(14), trace: trace(2), tier: "back", app: A, session: null, route: "/api/panier", ms: 110, avant: 12, parent: F4 },
  // Trafic serveur sans appel navigateur (tâche planifiée) : un nœud, aucune arête.
  { id: span(15), trace: trace(3), tier: "back", app: A, session: null, route: "/api/cron", ms: 50, avant: 15 },
  // Autre tenant, MÊME trace_id : ni nœud ni arête ne doivent traverser.
  { id: span(21), trace: trace(1), tier: "front", app: B, session: "f52-sb", route: "/panier", ms: 900, avant: 10 },
  { id: span(22), trace: trace(1), tier: "back", app: B, session: null, route: "/api/autre", ms: 800, avant: 10, parent: span(21) },
];

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of ["rum_metric", "rum_span", "rum_session", "app_registry"])
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
       values ('f52-sa', $1, 'desktop', false, 1, 1),
              ('f52-sb', $2, 'desktop', false, 1, 1)`,
      [A, B],
    );
    for (const s of SPANS) {
      await c.query(
        `insert into rum_span (span_id, trace_id, parent_span_id, tier, app_id, session_id, route, method, status_code, duration_ms, ts)
         values ($1, $2, $3, $4, $5, $6, $7, 'GET', 200, $8, now() - $9::int * interval '1 minute')`,
        [s.id, s.trace, s.parent ?? null, s.tier, s.app, s.session, s.route, s.ms, s.avant],
      );
    }
    // Deux routes mesurées, dont une SANS LCP : « Pages les plus visitées » doit
    // écrire « — », jamais un verdict « Bon » sur une absence (V3).
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
       values ('f52-m1', 'f52-sa', $1, '/panier', 'LCP', 1500, now() - interval '10 minutes'),
              ('f52-m2', 'f52-sa', $1, '/paiement', 'INP', 120, now() - interval '10 minutes')`,
      [A],
    );
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
  const map = await import("../../apps/console/lib/queries-map");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...map, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const filtres = (over: Partial<FiltersLike> = {}): FiltersLike => ({
  app: A,
  period: "1h",
  device: null,
  segment: [],
  includeBots: false,
  includeInternal: false,
  ...over,
});

(url ? describe : describe.skip)("lectures Carte F52 sur PostgreSQL", () => {
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

  describe("mapEdges — le jumeau serveur est l'ENFANT de l'appel, pas de la trace", () => {
    it("une trace à deux appels donne DEUX arêtes, pas quatre", async () => {
      const aretes = await lib.mapEdges(filtres());
      const cle = (e: { front_route: string; back_route: string }) => `${e.front_route} → ${e.back_route}`;
      const parCle = new Map(aretes.map((e) => [cle(e), e.calls]));
      // /panier appelle /api/panier deux fois (une par trace) et /api/stock une fois.
      expect(parCle.get("/panier → /api/panier")).toBe(2);
      expect(parCle.get("/panier → /api/stock")).toBe(1);
      expect(parCle.get("/paiement → /api/paiement")).toBe(1);
      // Le produit cartésien d'avant F52 en aurait rendu 4 sur la seule trace 1.
      expect(aretes.reduce((s, e) => s + e.calls, 0)).toBe(4);
    });

    it("aucun appel n'est rattaché à la mauvaise vue (navigation SPA en cours d'appel)", async () => {
      const aretes = await lib.mapEdges(filtres());
      const paires = aretes.map((e) => `${e.front_route} → ${e.back_route}`);
      // La réponse de l'appel de /panier n'appartient pas à la vue /paiement…
      expect(paires).not.toContain("/paiement → /api/panier");
      // … ni celle de l'appel de /paiement à la vue /panier.
      expect(paires).not.toContain("/panier → /api/paiement");
      expect(paires.sort()).toEqual(["/paiement → /api/paiement", "/panier → /api/panier", "/panier → /api/stock"]);
    });

    it("un trace_id partagé par deux tenants ne prête aucune arête à l'autre", async () => {
      const chezB = await lib.mapEdges(filtres({ app: B }));
      expect(chezB).toEqual([{ front_route: "/panier", back_route: "/api/autre", calls: 1 }]);
    });

    it("un span serveur sans appel navigateur (tâche planifiée) est un nœud, jamais une arête", async () => {
      const [noeuds, aretes] = await Promise.all([lib.mapNodes(filtres()), lib.mapEdges(filtres())]);
      expect(noeuds.find((n) => n.route === "/api/cron")).toMatchObject({ tier: "back", calls: 1 });
      expect(aretes.map((e) => e.back_route)).not.toContain("/api/cron");
    });
  });

  describe("mapNodes — volumes, latence et taux d'erreur par (tier, route)", () => {
    it("le front porte la route de la PAGE, le back la route serveur", async () => {
      const noeuds = await lib.mapNodes(filtres());
      const par = (tier: string, route: string) => noeuds.find((n) => n.tier === tier && n.route === route);
      expect(par("front", "/panier")).toMatchObject({ calls: 3, error_rate: 0 });
      expect(par("front", "/paiement")).toMatchObject({ calls: 1 });
      expect(par("back", "/api/panier")).toMatchObject({ calls: 2 });
      expect(par("back", "/api/stock")).toMatchObject({ calls: 1, latency_p75: 180 });
      // La somme des appels front égale le nombre de spans front semés dans A.
      expect(noeuds.filter((n) => n.tier === "front").reduce((s, n) => s + n.calls, 0)).toBe(4);
    });
  });

  describe("mapNodeSerie (B37) — la série du panneau nœud", () => {
    it("tous les seaux du contrat ; un seau vide vaut 0 appel et p75 null (un trou, pas 0 ms)", async () => {
      const base = filtres();
      const query = queryOf(base);
      const points = await lib.mapNodeSerie({ ...base, query }, "back", "/api/panier");
      expect(points.map((p) => p.t)).toEqual(bucketStarts(query.range).map((ms) => new Date(ms).toISOString()));
      expect(points.reduce((s, p) => s + p.appels, 0)).toBe(2);
      for (const p of points) {
        if (p.appels === 0) expect(p.p75).toBeNull();
        else expect(p.p75).not.toBeNull();
      }
      const pleins = points.filter((p) => p.appels > 0);
      expect(pleins.length).toBeGreaterThanOrEqual(1);
      // 90 et 110 ms : aucun seau ne peut porter une p75 hors de cet intervalle.
      for (const p of pleins) expect(p.p75! >= 90 && p.p75! <= 110).toBe(true);
    });

    it("un nœud inconnu rend la grille entière à zéro, jamais une liste vide", async () => {
      const base = filtres();
      const query = queryOf(base);
      const points = await lib.mapNodeSerie({ ...base, query }, "back", "/api/inexistante");
      expect(points).toHaveLength(bucketStarts(query.range).length);
      expect(points.every((p) => p.appels === 0 && p.p75 === null)).toBe(true);
    });

    it("périmètre : B ne lit pas la série d'un nœud de A", async () => {
      const base = filtres({ app: B });
      const query = queryOf(base);
      const points = await lib.mapNodeSerie({ ...base, query }, "back", "/api/panier");
      expect(points.every((p) => p.appels === 0)).toBe(true);
    });
  });

  describe("mapPages — les routes les plus MESURÉES (pas les pages d'entrée)", () => {
    it("une route sans LCP rend `lcp_p75` null : aucun verdict ne peut s'y poser", async () => {
      const pages = await lib.mapPages(filtres());
      expect(pages.find((p) => p.route === "/panier")).toMatchObject({ sessions: 1, lcp_p75: 1500 });
      expect(pages.find((p) => p.route === "/paiement")).toMatchObject({ sessions: 1, lcp_p75: null });
    });
  });
});
