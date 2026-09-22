// F41 — lectures de la rangée de KPI de /sessions, sur un vrai PostgreSQL.
//
// CE QUE LA BASE SEULE PEUT DIRE :
//   - B39 : les occurrences sont celles des erreurs RATTACHÉES aux sessions
//     commencées dans la fenêtre (y compris celles d'après `to`), divisées par CES
//     sessions ; une session commencée avant `from` n'entre dans aucun terme, même si
//     ses erreurs tombent dans la fenêtre ; les erreurs sans session sont comptées à
//     part — le cas du plan (§ 5.11.4) : S1, S2, une erreur orpheline → 3,00 et 2 ;
//   - la tuile « Sessions commencées » et sa sparkline comptent la MÊME population :
//     somme des seaux = `sessions_started` ;
//   - la période précédente (`shift`) est relue sur SES bornes ;
//   - visiteurs distincts et répartition passent par l'Explorer : identifiant
//     aléatoire seulement, « Inconnu » à part, périmètre d'apps lié.
//
// COMMENT L'EXÉCUTER. Ce fichier applique le schéma COMPLET : base JETABLE.
//   SQL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/<jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

/** Le cas du plan, seul dans son app : S1, S2 et une erreur orpheline. */
const PLAN = "f41-b39";
/** Population plus large : visiteurs, navigateurs, capteur, robot. */
const A = "f41-a";
const B = "f41-b";
const APPS = [PLAN, A, B];

const HEURE = 3_600_000;
const NOW = Date.now();
const IL_Y_A = (ms: number) => new Date(NOW - ms);

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
  for (const table of ["rum_error", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

interface Session {
  id: string;
  app: string;
  debut: Date;
  fin: Date;
  visiteur?: string | null;
  navigateur?: string | null;
  capteur?: string;
  bot?: boolean;
}

async function session(c: pg.Client, s: Session): Promise<void> {
  await c.query(
    `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, page_count,
                              visitor_id, browser, collection_source)
     values ($1, $2, 'desktop', $3, $4, $5, 1, $6, $7, $8)`,
    [s.id, s.app, s.bot ?? false, s.debut, s.fin, s.visiteur ?? null, s.navigateur ?? null, s.capteur ?? "sdk"],
  );
}

let rang = 0;
async function erreur(c: pg.Client, app: string, sid: string | null, occurrences: number, ts: Date): Promise<void> {
  rang += 1;
  await c.query(
    `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, ts)
     values ($1, $2, $3, 'error', 'boom', 'TypeError', 'f41-fp', $4, $5)`,
    [`f41-err-${rang}`, sid, app, occurrences, ts],
  );
}

async function semer(c: pg.Client): Promise<void> {
  // ── Le cas du plan ────────────────────────────────────────────────────────
  // S1 commencée dans la plage, 3 occurrences ; S2 commencée AVANT `from` (30 h),
  // 5 occurrences datées DANS la plage ; une erreur sans session, 2 occurrences.
  await session(c, { id: "f41-s1", app: PLAN, debut: IL_Y_A(2 * HEURE), fin: IL_Y_A(HEURE) });
  await session(c, { id: "f41-s2", app: PLAN, debut: IL_Y_A(30 * HEURE), fin: IL_Y_A(HEURE) });
  await erreur(c, PLAN, "f41-s1", 3, IL_Y_A(1.5 * HEURE));
  await erreur(c, PLAN, "f41-s2", 5, IL_Y_A(2 * HEURE));
  await erreur(c, PLAN, null, 2, IL_Y_A(HEURE));

  // ── Population A (et B, qui ne doit jamais y entrer) ─────────────────────────
  await session(c, { id: "f41-a1", app: A, debut: IL_Y_A(2 * HEURE), fin: IL_Y_A(HEURE), visiteur: "f41-v1", navigateur: "Firefox" });
  await session(c, { id: "f41-a2", app: A, debut: IL_Y_A(3 * HEURE), fin: IL_Y_A(3 * HEURE), visiteur: "f41-v1", navigateur: "Firefox", capteur: "extension" });
  await session(c, { id: "f41-a3", app: A, debut: IL_Y_A(4 * HEURE), fin: IL_Y_A(4 * HEURE), visiteur: null, navigateur: null });
  await session(c, { id: "f41-a4", app: A, debut: IL_Y_A(2 * HEURE), fin: IL_Y_A(HEURE), visiteur: "f41-bot", navigateur: "Chrome", bot: true });
  await session(c, { id: "f41-b1", app: B, debut: IL_Y_A(2 * HEURE), fin: IL_Y_A(HEURE), visiteur: "f41-vb", navigateur: "Safari" });
  await erreur(c, A, "f41-a1", 4, IL_Y_A(HEURE));
  await erreur(c, A, "f41-a4", 11, IL_Y_A(HEURE)); // robot : exclu
  await erreur(c, B, "f41-b1", 7, IL_Y_A(HEURE)); // autre app : jamais dans A
  // Une erreur de A qui CITE la session de B : pas rattachée (jointure app-scopée),
  // donc comptée sans session — jamais ajoutée aux occurrences de A.
  await erreur(c, A, "f41-b1", 6, IL_Y_A(HEURE));
}

/** Modules console branchés sur la base jetable (cf. echantillonnage-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const sessions = await import("../../apps/console/lib/queries-sessions");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...sessions, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const ADMIN: ScopePrincipal = { role: "admin", apps: null };
const VIEWER_A: ScopePrincipal = { role: "viewer", apps: [A] };

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

(url ? describe : describe.skip)("lectures de la rangée de KPI de /sessions sur PostgreSQL (F41, B39)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  const f = (qs: string, principal: ScopePrincipal = ADMIN) => lib.filtersOfQuery(requete(qs, principal));

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

  describe("erreursParSessionCommencee (B39)", () => {
    it("le cas du plan : S1 (3), S2 commencée avant from (5), une orpheline (2) → 3,00 et « 2 sans session »", async () => {
      const e = await lib.erreursParSessionCommencee(f(`app=${PLAN}&period=24h`));
      expect(e).toEqual({ sessions: 1, occurrences: 3, sansSession: 2 });
      expect((e.occurrences / e.sessions).toFixed(2)).toBe("3.00");
    });

    it("période précédente : S2 y commence, ses 5 occurrences la suivent ; aucune orpheline", async () => {
      expect(await lib.erreursParSessionCommencee(f(`app=${PLAN}&period=24h`), true)).toEqual({
        sessions: 1,
        occurrences: 5,
        sansSession: 0,
      });
    });

    it("une erreur d'APRÈS `to` compte pour une session commencée dans la plage", async () => {
      // Plage passée [−3 h, −1,75 h) : S1 y commence (−2 h) ; son erreur (−1,5 h) est après `to`.
      const from = new Date(NOW - 3 * HEURE).toISOString();
      const to = new Date(NOW - 1.75 * HEURE).toISOString();
      const e = await lib.erreursParSessionCommencee(
        f(`app=${PLAN}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      );
      expect(e).toEqual({ sessions: 1, occurrences: 3, sansSession: 0 });
    });

    it("aucune session commencée : dénominateur 0 (l'écran rend « — », jamais « 0 »)", async () => {
      const e = await lib.erreursParSessionCommencee(f(`app=${PLAN}&period=1h`));
      expect(e.sessions).toBe(0);
      expect(e.occurrences).toBe(0);
    });

    it("robot exclu, autre app jamais lue, erreur citant la session d'une autre app comptée sans session", async () => {
      expect(await lib.erreursParSessionCommencee(f(`app=${A}&period=24h`))).toEqual({
        sessions: 3, // a1, a2, a3 ; a4 est un robot
        occurrences: 4, // a1 seulement : les 11 du robot et les 7 de B n'entrent pas
        sansSession: 6, // l'erreur de A qui cite f41-b1
      });
    });

    it("viewer restreint à A sous « toutes ses apps » : B et l'app du plan jamais lues", async () => {
      expect(await lib.erreursParSessionCommencee(f("period=24h", VIEWER_A))).toMatchObject({ sessions: 3, occurrences: 4 });
    });
  });

  describe("Sessions commencées : tuile et sparkline, une seule population", () => {
    it("somme des sessions par seau = sessions_started (et de même sur la période précédente)", async () => {
      for (const qs of [`app=${A}&period=24h`, `app=${PLAN}&period=24h`, `app=${PLAN}&period=7d`]) {
        const serie = await lib.observedVisitorsTrend(f(qs));
        const engagement = await lib.engagementStats(f(qs));
        expect(serie.reduce((s, p) => s + p.sessions, 0), qs).toBe(engagement.sessions_started);
        const seriePrec = await lib.observedVisitorsTrend(f(qs), true);
        const engagementPrec = await lib.engagementStats(f(qs), true);
        expect(seriePrec.reduce((s, p) => s + p.sessions, 0), `${qs} (précédente)`).toBe(engagementPrec.sessions_started);
        // Même nombre de seaux : la référence se pose par rang.
        expect(seriePrec.length, qs).toBe(serie.length);
      }
    });

    it("sans identifiant compté à part, jamais dans les visiteurs", async () => {
      const serie = await lib.observedVisitorsTrend(f(`app=${A}&period=24h`));
      expect(serie.reduce((s, p) => s + p.sans_identifiant, 0)).toBe(1); // a3
    });
  });

  describe("visiteurs distincts et répartition (lecture Explorer)", () => {
    it("visiteurs distincts : identifiant aléatoire seulement, robot exclu", async () => {
      // a1 et a2 partagent f41-v1 ; a3 n'a pas d'identifiant ; a4 est un robot.
      expect(await lib.visiteursDistincts(requete(`app=${A}&period=24h`))).toBe(1);
    });

    it("répartition par navigateur : « Inconnu » à part, total = sessions commencées", async () => {
      const r = await lib.repartitionSessions(requete(`app=${A}&period=24h`), "browser");
      expect(r.total).toBe(3);
      expect(r.tronque).toBe(false);
      expect(r.groupes).toContainEqual({ valeur: "Firefox", sessions: 2 });
      expect(r.groupes).toContainEqual({ valeur: null, sessions: 1 });
      expect(r.groupes.some((g) => g.valeur === "Safari" || g.valeur === "Chrome")).toBe(false);
    });

    it("répartition par capteur : SDK et extension", async () => {
      const r = await lib.repartitionSessions(requete(`app=${A}&period=24h`), "source");
      expect(r.groupes).toContainEqual({ valeur: "sdk", sessions: 2 });
      expect(r.groupes).toContainEqual({ valeur: "extension", sessions: 1 });
    });
  });
});
