// Signaux de vue du SDK web ≥ 0.6 (04/10/2026) — lectures de `queries-engagement.ts`
// et exclusion de ces mesures des lectures de Web Vitals, sur un vrai PostgreSQL.
//
// Ce que seule la base peut dire :
//   - engagement, changements d'écran SPA, poids des vues et repères comptent la
//     BONNE population (périmètre lié, robots exclus, `apps = []` = rien) ;
//   - sous 13 mesures, ni médiane ni p75 : `null` et « 3 vues, 13 requises » ;
//   - l'ensemble (`grouping sets`) compte aussi les vues sans route ;
//   - TIME_SPENT, SCROLL_DEPTH, SPA_LOAD, RESOURCE_COUNT et RESOURCE_BYTES ne sortent
//     ni de `vitalsP75`, ni de `vitalPercentiles`, ni de la chronologie d'une session,
//     et une route qui n'a qu'eux n'entre pas dans `slowRoutes`.
//
// COMMENT L'EXÉCUTER. Ce fichier applique le schéma COMPLET : base JETABLE.
//   SQL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/<jetable> pnpm vitest run tests/integration/engagement-sql.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A = "engagement-sql-a";
const B = "engagement-sql-b";
const APPS = [A, B];

const HEURE = 3_600_000;
const FIN = Math.floor(Date.now() / HEURE) * HEURE;
const DEBUT = FIN - 6 * HEURE;
const H = (i: number, minutes = 10) => new Date(DEBUT + i * HEURE + minutes * 60_000);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

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
  for (const table of ["rum_event", "rum_metric", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

type Mesure = [route: string | null, nom: string, valeur: number];

async function semer(c: pg.Client): Promise<void> {
  // A : 15 sessions d'une vue sur /a, 3 sur /b, 1 sans route, 1 robot (sur /a).
  const sessions: { id: string; app: string; bot?: boolean; route: string | null; mesures: Mesure[] }[] = [];
  for (let i = 0; i < 15; i++) {
    sessions.push({
      id: `eng-a${i}`,
      app: A,
      route: "/a",
      mesures: [
        ["/a", "TIME_SPENT", (i + 1) * 1000], // 1 000 … 15 000 ms
        ["/a", "SCROLL_DEPTH", i < 10 ? 80 : 40], // 10 vues sur 15 à 75 % ou plus
        ["/a", "RESOURCE_COUNT", 10 + i], // 10 … 24
        ["/a", "RESOURCE_BYTES", (i + 1) * 10_000],
        ...(i < 13 ? ([["/a", "SPA_LOAD", (i + 1) * 100]] as Mesure[]) : []), // 13 chargements, 100 … 1 300 ms
      ],
    });
  }
  for (let i = 0; i < 3; i++) {
    sessions.push({ id: `eng-b${i}`, app: A, route: "/b", mesures: [["/b", "TIME_SPENT", 60_000], ["/b", "SCROLL_DEPTH", 100]] });
  }
  sessions.push({ id: "eng-sans-route", app: A, route: null, mesures: [[null, "TIME_SPENT", 5000]] });
  sessions.push({
    id: "eng-robot",
    app: A,
    bot: true,
    route: "/a",
    mesures: [["/a", "TIME_SPENT", 9_999_999], ["/a", "SPA_LOAD", 9_999_999]],
  });
  // B : une session, un vital et un temps passé ; jamais sous A.
  sessions.push({ id: "eng-b-app", app: B, route: "/b", mesures: [["/b", "TIME_SPENT", 1], ["/b", "LCP", 1200]] });
  // A : une session avec un vrai LCP, pour vérifier ce que rendent les lectures de vitals.
  sessions.push({ id: "eng-lcp", app: A, route: "/a", mesures: [["/a", "LCP", 2000]] });

  for (const s of sessions) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ($1, $2, 'desktop', $3, $4, $5, 1, 1)`,
      [s.id, s.app, s.bot ?? false, H(1), H(2)],
    );
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, nav_type, started_at)
       values ($1, $2, $3, $4, 'https://site.example/', 'navigate', $5)`,
      [`${s.id}-pv`, s.id, s.app, s.route ?? "/", H(1)],
    );
    for (const [route, nom, valeur] of s.mesures) {
      await c.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts, metric_uid)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [`${s.id}-${nom}`, s.id, s.app, route, nom, valeur, H(1, 20), `${s.id}-vue`],
      );
    }
  }

  // Repères : 13 marks, 2 measures, 13 timings manuels, un démarrage mobile (écarté).
  const reperes: [string, string, number][] = [];
  for (let i = 0; i < 13; i++) reperes.push([`eng-a${i}`, "mark:hero-visible", (i + 1) * 10]);
  for (let i = 0; i < 2; i++) reperes.push([`eng-a${i}`, "measure:api-produits", 300]);
  for (let i = 0; i < 13; i++) reperes.push([`eng-a${i}`, "panier_pret", 500 + i]);
  reperes.push(["eng-a0", "js_start_to_first_screen_ms", 800]);
  reperes.push(["eng-robot", "mark:hero-visible", 9_999_999]);
  let k = 0;
  for (const [sid, nom, ms] of reperes) {
    await c.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, event_type, timing_ms, ts)
       values ($1, $2, $3, '/a', $4, 'timing', $5, $6)`,
      [`eng-ev-${k++}`, sid, A, nom, ms, H(1, 30)],
    );
  }
  // Un événement qui n'est pas un timing : jamais un repère.
  await c.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, event_type, ts)
     values ('eng-ev-custom', 'eng-a0', $1, '/a', 'mark:faux', 'custom', $2)`,
    [A, H(1, 30)],
  );
}

async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const engagement = await import("../../apps/console/lib/queries-engagement");
  const queries = await import("../../apps/console/lib/queries");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...engagement, ...queries, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const ADMIN: ScopePrincipal = { role: "admin", apps: null };
const FENETRE = `from=${iso(DEBUT)}&to=${iso(FIN)}`;

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

const VUE = ["TIME_SPENT", "SCROLL_DEPTH", "SPA_LOAD", "RESOURCE_COUNT", "RESOURCE_BYTES"];

(url ? describe : describe.skip)("signaux de vue du SDK web ≥ 0.6 sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  const fA = () => lib.filtersOfQuery(requete(`${FENETRE}&app=${A}`));
  const fVide = () => {
    const q = requete(`${FENETRE}&app=${A}`);
    return lib.filtersOfQuery({ ...q, scope: { ...q.scope, authorizedApps: [], effectiveApps: [] } });
  };

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

  describe("engagementParRoute", () => {
    it("par route : temps p50/p75, défilement p50, part ≥ 75 % ; robot exclu", async () => {
      const lu = await lib.engagementParRoute(fA());
      const a = lu.routes.find((r) => r.route === "/a")!;
      expect(a.vues).toBe(15);
      expect(a.temps_p50_ms).toBe(8000);
      expect(a.temps_p75_ms).toBe(11_500);
      expect(a.manque).toBeNull();
      expect(a.defilement_n).toBe(15);
      expect(a.defilement_p50_pct).toBe(80);
      expect(a.part_defilement_profond).toBeCloseTo(10 / 15, 10);
    });

    it("sous 13 vues : null et ce qui manque, jamais 0", async () => {
      const b = (await lib.engagementParRoute(fA())).routes.find((r) => r.route === "/b")!;
      expect(b.vues).toBe(3);
      expect(b.temps_p50_ms).toBeNull();
      expect(b.temps_p75_ms).toBeNull();
      expect(b.part_defilement_profond).toBeNull();
      expect(b.manque).toBe("3 vues, 13 requises");
    });

    it("l'ensemble compte les vues sans route ; les routes non, classées par vues", async () => {
      const lu = await lib.engagementParRoute(fA());
      expect(lu.ensemble.route).toBeNull();
      expect(lu.ensemble.vues).toBe(19); // 15 + 3 + 1 sans route
      expect(lu.routes.map((r) => r.route)).toEqual(["/a", "/b"]);
      expect(lu.routesTotal).toBe(2);
      expect(lu.tronque).toBe(false);
      expect(lu.requis).toBe(13);
    });

    it("plafond : une route sur deux, et le dit", async () => {
      const lu = await lib.engagementParRoute(fA(), 1);
      expect(lu.routes.map((r) => r.route)).toEqual(["/a"]);
      expect(lu.routesTotal).toBe(2);
      expect(lu.tronque).toBe(true);
    });

    it("apps = [] : rien, ensemble vide", async () => {
      const lu = await lib.engagementParRoute(fVide());
      expect(lu.routes).toEqual([]);
      expect(lu.ensemble.vues).toBe(0);
      expect(lu.ensemble.temps_p50_ms).toBeNull();
    });
  });

  describe("chargementsSpaParRoute", () => {
    it("13 chargements sur /a : p50 et p75, robot exclu", async () => {
      const lu = await lib.chargementsSpaParRoute(fA());
      expect(lu.ensemble.n).toBe(13);
      expect(lu.ensemble.p50_ms).toBe(700);
      expect(lu.ensemble.p75_ms).toBe(1000);
      expect(lu.routes).toEqual([{ route: "/a", n: 13, p50_ms: 700, p75_ms: 1000, manque: null }]);
    });
  });

  describe("poidsDesVuesParRoute", () => {
    it("ressources par vue p50, octets par vue p75", async () => {
      const a = (await lib.poidsDesVuesParRoute(fA())).routes.find((r) => r.route === "/a")!;
      expect(a.vues).toBe(15);
      expect(a.ressources_p50).toBe(17);
      expect(a.octets_n).toBe(15);
      expect(a.octets_p75).toBe(115_000);
    });
  });

  describe("reperesParNom", () => {
    it("par nom, avec sa source ; démarrage mobile, robot et événement non timing écartés", async () => {
      const lu = await lib.reperesParNom(fA());
      expect(lu.reperes.map((r) => [r.nom, r.source, r.n])).toEqual([
        ["mark:hero-visible", "mark", 13],
        ["panier_pret", "manuel", 13],
        ["measure:api-produits", "measure", 2],
      ]);
      const mark = lu.reperes[0];
      expect(mark.p50_ms).toBe(70);
      expect(mark.p75_ms).toBe(100);
      const measure = lu.reperes[2];
      expect(measure.p50_ms).toBeNull();
      expect(measure.manque).toBe("2 mesures, 13 requises");
      expect(lu.total).toBe(3);
    });

    it("apps = [] : aucun repère", async () => {
      expect((await lib.reperesParNom(fVide())).reperes).toEqual([]);
    });
  });

  describe("les mesures de vue ne sont pas des Web Vitals", () => {
    it("vitalsP75 et vitalPercentiles ne les rendent pas", async () => {
      const f = fA();
      const noms = (await lib.vitalsP75(f)).map((v) => v.name);
      expect(noms).toEqual(["LCP"]);
      const pcts = (await lib.vitalPercentiles(f)).map((v) => v.name);
      expect(pcts).toEqual(["LCP"]);
    });

    it("slowRoutes et nombreDeRoutes ignorent une route qui n'a que des mesures de vue", async () => {
      const f = fA();
      expect((await lib.slowRoutes(f)).map((r) => r.route)).toEqual(["/a"]);
      expect(await lib.nombreDeRoutes(f)).toBe(1);
    });

    it("la population de l'échantillonnage des vitals est celle des sessions à vital", async () => {
      expect((await lib.samplingVitals(fA())).sessions).toBe(1);
    });

    it("la chronologie d'une session ne les montre pas comme des vitals", async () => {
      const items = await lib.sessionTimeline("eng-a0", A);
      expect(items.some((i) => i.kind === "vital" && VUE.includes(String(i.title)))).toBe(false);
      expect(items.some((i) => i.kind === "pageview")).toBe(true);
    });
  });
});
