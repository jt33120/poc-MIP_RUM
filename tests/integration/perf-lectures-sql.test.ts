// F10 — lectures partagées du domaine performance (plan § 4.5), sur un vrai PostgreSQL.
//
// Ce que seule la base peut dire : que chaque lecture compte la BONNE population
// (périmètre d'apps lié, viewer restreint, `apps = []` = zéro, bots exclus), sur la
// GRILLE du contrat (un point par seau attendu : `null` pour un seau sans mesure,
// 0 seulement pour un compte), et que les définitions du plan tiennent :
//   - une erreur `node` sans session n'entre pas dans `erreursNavigateur.navigateur` ;
//   - une session touchée sans vue dans la fenêtre n'entre pas au numérateur de la
//     part des sessions touchées ; une session sr = 0,1 / esr = 1 donne `tauxMin` 0,1 ;
//   - `pageviewSeries` sépare les changements de route SPA ;
//   - `vitalSeriesN` rend l'effectif de chaque seau.
//
// Étendu par F18, F20, F22, F26 (nouveauxGroupes, topGroupesSeries, frustration…).
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

const A = "f10-perf-a";
const B = "f10-perf-b";
// C : une seule session, commencée avant v58, avec une vue dans la fenêtre.
const C = "f10-perf-c";
const APPS = [A, B, C];

// Fenêtre FIXE de 6 heures pleines, finie à l'heure pleine passée : seaux d'une
// heure (`bucketSecondsFor`), alignés, donc une grille de 6 seaux exactement.
const HEURE = 3_600_000;
const FIN = Math.floor(Date.now() / HEURE) * HEURE;
const DEBUT = FIN - 6 * HEURE;
/** Instant dans le seau `i` de la fenêtre (i < 0 : période précédente). */
const H = (i: number, minutes = 10) => new Date(DEBUT + i * HEURE + minutes * 60_000);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const GRILLE = Array.from({ length: 6 }, (_, i) => iso(DEBUT + i * HEURE));
const GRILLE_PRECEDENTE = Array.from({ length: 6 }, (_, i) => iso(DEBUT - 6 * HEURE + i * HEURE));
// Avant v58 (09/09/2026) : `sample_rate` vaut 1 PAR DÉFAUT, pas par mesure.
const AOUT = new Date("2026-08-01T00:00:00Z");

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
  for (const table of ["rum_error", "rum_metric", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

interface Session {
  id: string;
  app: string;
  debut: Date;
  fin: Date;
  sr?: number;
  esr?: number;
  erreur?: boolean;
  bot?: boolean;
}

async function semer(c: pg.Client): Promise<void> {
  const sessions: Session[] = [
    // A : trois vues (chargement, SPA, rechargement), 4 LCP, une erreur navigateur.
    { id: "f10-a1", app: A, debut: H(0, 5), fin: H(2, 30), erreur: true },
    // A : une vue sans nav_type (émetteur qui ne le déclare pas), aucune erreur.
    { id: "f10-a2", app: A, debut: H(1, 5), fin: H(1, 20) },
    // A : une erreur DANS la fenêtre, mais sa seule vue est dans la période précédente.
    { id: "f10-a3", app: A, debut: H(-2), fin: H(3, 30), erreur: true },
    // A : un robot, avec vue, erreur et LCP : exclu par défaut de toutes les lectures.
    { id: "f10-a4", app: A, debut: H(0, 5), fin: H(0, 30), bot: true, erreur: true },
    // A : commencée avant v58, encore active : taux d'échantillonnage non enregistré.
    { id: "f10-a5", app: A, debut: AOUT, fin: H(4, 30) },
    // B : échantillonnée à 10 %, promue par son erreur (esr = 1).
    { id: "f10-b1", app: B, debut: H(0, 5), fin: H(0, 40), sr: 0.1, esr: 1, erreur: true },
    // B : échantillonnée à 50 %, sans erreur : p = 0,5.
    { id: "f10-b2", app: B, debut: H(1, 5), fin: H(1, 40), sr: 0.5, esr: 0 },
    // C : commencée avant v58 (sample_rate = 1 PAR DÉFAUT), revue dans la fenêtre.
    { id: "f10-c1", app: C, debut: AOUT, fin: H(2, 30) },
  ];
  for (const s of sessions) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at,
                                sample_rate, error_sample_rate, has_error)
       values ($1, $2, 'desktop', $3, $4, $5, $6, $7, $8)`,
      [s.id, s.app, s.bot ?? false, s.debut, s.fin, s.sr ?? 1, s.esr ?? 1, s.erreur ?? false],
    );
  }

  const vues: [string, string, string, string | null, Date][] = [
    ["f10-pv-a1-0", "f10-a1", A, "navigate", H(0)],
    ["f10-pv-a1-1", "f10-a1", A, "spa", H(0, 20)],
    ["f10-pv-a1-2", "f10-a1", A, "reload", H(2)],
    ["f10-pv-a2-0", "f10-a2", A, null, H(1)],
    ["f10-pv-a3-0", "f10-a3", A, "navigate", H(-1)], // période précédente seulement
    ["f10-pv-a4-0", "f10-a4", A, "navigate", H(0)], // robot
    ["f10-pv-b1-0", "f10-b1", B, "navigate", H(0)],
    ["f10-pv-b2-0", "f10-b2", B, "navigate", H(1)],
    ["f10-pv-c1-0", "f10-c1", C, "navigate", H(2)],
  ];
  for (const [span, sid, app, nav, ts] of vues) {
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, nav_type, started_at)
       values ($1, $2, $3, '/', 'https://site.example/', $4, $5)`,
      [span, sid, app, nav, ts],
    );
  }

  const mesures: [string, string, string, string, number, Date][] = [
    ["f10-m-a1-0", "f10-a1", A, "LCP", 1000, H(0)],
    ["f10-m-a1-1", "f10-a1", A, "LCP", 2000, H(0, 20)],
    ["f10-m-a1-2", "f10-a1", A, "LCP", 3000, H(0, 30)],
    ["f10-m-a1-3", "f10-a1", A, "LCP", 4000, H(2)],
    ["f10-m-a4-0", "f10-a4", A, "LCP", 99_000, H(0)], // robot
    ["f10-m-a5-0", "f10-a5", A, "INP", 150, H(4)], // session d'avant v58
    ["f10-m-a3-p", "f10-a3", A, "LCP", 5000, H(-1)], // période précédente
    ["f10-m-b1-0", "f10-b1", B, "LCP", 9000, H(0)],
    ["f10-m-b2-0", "f10-b2", B, "LCP", 8000, H(1)],
  ];
  for (const [span, sid, app, nom, valeur, ts] of mesures) {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
       values ($1, $2, $3, '/', $4, $5, $6)`,
      [span, sid, app, nom, valeur, ts],
    );
  }

  const erreurs: [string, string | null, string, string | null, number, Date, string][] = [
    ["f10-e-a1", "f10-a1", A, "browser_js", 3, H(0), "fp-a1"],
    ["f10-e-a3", "f10-a3", A, "browser_js", 1, H(3), "fp-a3"], // session sans vue dans la fenêtre
    ["f10-e-node", null, A, "node", 5, H(1), "fp-node"], // backend, sans session
    ["f10-e-nul", null, A, null, 2, H(3), "fp-nul"], // source non déclarée
    ["f10-e-a4", "f10-a4", A, "browser_js", 50, H(0), "fp-a4"], // robot
    ["f10-e-b1", "f10-b1", B, "browser_js", 7, H(0), "fp-b1"],
  ];
  for (const [span, sid, app, source, occ, ts, fp] of erreurs) {
    await c.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type,
                              fingerprint, occurrences, error_source, ts)
       values ($1, $2, $3, '/', 'error', 'boom', 'Error', $4, $5, $6, $7)`,
      [span, sid, app, fp, occ, source, ts],
    );
  }
}

/** Modules console branchés sur la base jetable (cf. comparaison-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const queries = await import("../../apps/console/lib/queries");
  const errors = await import("../../apps/console/lib/queries-errors");
  const { engagementStats } = await import("../../apps/console/lib/queries-sessions");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...queries, ...errors, engagementStats, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const ADMIN: ScopePrincipal = { role: "admin", apps: null };
const VIEWER_A: ScopePrincipal = { role: "viewer", apps: [A] };
const FENETRE = `from=${iso(DEBUT)}&to=${iso(FIN)}`;

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

/** Un périmètre VIDE (principal sans aucune app) : zéro ligne, jamais « toutes ». */
function sansApp(query: AnalyticsQuery): AnalyticsQuery {
  return { ...query, scope: { ...query.scope, authorizedApps: [], effectiveApps: [] } };
}

(url ? describe : describe.skip)("lectures partagées du domaine performance sur PostgreSQL (F10)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  const f = (qs: string, principal: ScopePrincipal = ADMIN) => lib.filtersOfQuery(requete(`${FENETRE}&${qs}`, principal));
  const fA = () => f(`app=${A}`);
  const fB = () => f(`app=${B}`);
  /** Viewer restreint à A, sous « toutes ses apps » (aucun `app=`) : apps EFFECTIVES liées. */
  const fViewer = () => f("", VIEWER_A);
  const fVide = () => lib.filtersOfQuery(sansApp(requete(`${FENETRE}&app=${A}`)));
  /** Population vide mais périmètre valide : aucune session mobile semée. */
  const fMobile = () => f(`app=${A}&device=mobile`);

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

  // ─────────────────────────────── vitalSeriesN ───────────────────────────────

  describe("vitalSeriesN", () => {
    it("un point par seau de la grille, p75 et n par seau ; robot exclu", async () => {
      const serie = await lib.vitalSeriesN(fA(), "LCP");
      expect(serie.map((p) => p.bucket)).toEqual(GRILLE);
      expect(serie[0]).toEqual({ bucket: GRILLE[0], p75: 2500, n: 3 }); // p75 de 1000/2000/3000
      expect(serie[2]).toEqual({ bucket: GRILLE[2], p75: 4000, n: 1 });
    });

    it("seau vide = null (un trou), n = 0 — jamais 0 ms", async () => {
      const serie = await lib.vitalSeriesN(fA(), "LCP");
      for (const i of [1, 3, 4, 5]) expect(serie[i]).toEqual({ bucket: GRILLE[i], p75: null, n: 0 });
    });

    it("shift : la période précédente, sur sa propre grille, même nombre de seaux", async () => {
      const serie = await lib.vitalSeriesN(fA(), "LCP", true);
      expect(serie.map((p) => p.bucket)).toEqual(GRILLE_PRECEDENTE);
      expect(serie[5]).toEqual({ bucket: GRILLE_PRECEDENTE[5], p75: 5000, n: 1 });
      expect(serie.filter((p) => p.p75 !== null)).toHaveLength(1);
    });

    it("périmètre : B jamais sous A ; viewer restreint = A ; apps = [] → grille entièrement vide", async () => {
      expect((await lib.vitalSeriesN(fB(), "LCP")).map((p) => p.n)).toEqual([1, 1, 0, 0, 0, 0]);
      expect(await lib.vitalSeriesN(fViewer(), "LCP")).toEqual(await lib.vitalSeriesN(fA(), "LCP"));
      const vide = await lib.vitalSeriesN(fVide(), "LCP");
      expect(vide).toHaveLength(6);
      expect(vide.every((p) => p.p75 === null && p.n === 0)).toBe(true);
    });
  });

  // ───────────────────────────── sessionsAvecVue ─────────────────────────────

  describe("sessionsAvecVue", () => {
    it("sessions distinctes avec au moins une vue dans la fenêtre ; robot et session sans vue exclus", async () => {
      expect(await lib.sessionsAvecVue(fA())).toBe(2); // a1 (3 vues), a2 ; a3 n'a de vue qu'avant
    });

    it("shift : la période précédente (a3)", async () => {
      expect(await lib.sessionsAvecVue(fA(), true)).toBe(1);
    });

    it("périmètre : app liée, viewer restreint, apps = [] → 0 ; population vide → 0", async () => {
      expect(await lib.sessionsAvecVue(fB())).toBe(2);
      expect(await lib.sessionsAvecVue(fViewer())).toBe(2);
      expect(await lib.sessionsAvecVue(fVide())).toBe(0);
      expect(await lib.sessionsAvecVue(fMobile())).toBe(0);
    });
  });

  // ───────────────────────────── pageviewSeries ──────────────────────────────

  describe("pageviewSeries", () => {
    it("sépare chargements, changements de route SPA et vues sans nav_type", async () => {
      const serie = await lib.pageviewSeries(fA());
      expect(serie.map((p) => p.bucket)).toEqual(GRILLE);
      expect(serie[0]).toEqual({ bucket: GRILLE[0], chargements: 1, spa: 1, inconnu: 0 });
      expect(serie[1]).toEqual({ bucket: GRILLE[1], chargements: 0, spa: 0, inconnu: 1 });
      expect(serie[2]).toEqual({ bucket: GRILLE[2], chargements: 1, spa: 0, inconnu: 0 });
    });

    it("série additive : seau vide = 0 (un compte), et Σ seaux = pages vues de overviewStats", async () => {
      const serie = await lib.pageviewSeries(fA());
      for (const i of [3, 4, 5]) expect(serie[i]).toEqual({ bucket: GRILLE[i], chargements: 0, spa: 0, inconnu: 0 });
      const somme = serie.reduce((s, p) => s + p.chargements + p.spa + p.inconnu, 0);
      expect(somme).toBe((await lib.overviewStats(fA())).pageviews);
    });

    it("shift et périmètre : période précédente ; viewer = A ; apps = [] → zéros", async () => {
      const avant = await lib.pageviewSeries(fA(), true);
      expect(avant.map((p) => p.bucket)).toEqual(GRILLE_PRECEDENTE);
      expect(avant[5]).toMatchObject({ chargements: 1 });
      expect(await lib.pageviewSeries(fViewer())).toEqual(await lib.pageviewSeries(fA()));
      expect((await lib.pageviewSeries(fB())).map((p) => p.chargements)).toEqual([1, 1, 0, 0, 0, 0]);
      const vide = await lib.pageviewSeries(fVide());
      expect(vide).toHaveLength(6);
      expect(vide.every((p) => p.chargements === 0 && p.spa === 0 && p.inconnu === 0)).toBe(true);
    });
  });

  // ────────────────────────── errorSeries, erreursNavigateur ──────────────────────────

  describe("erreursNavigateur", () => {
    it("une erreur node sans session n'entre pas dans `navigateur` ; source nulle comptée à part", async () => {
      expect(await lib.erreursNavigateur(fA())).toEqual({
        restreint: true,
        navigateur: 4, // a1 (3) + a3 (1) ; robot exclu
        sansSource: 2,
        serveur: 5, // node, sans session
      });
    });

    it("shift : rien sur la période précédente → zéros (des comptes)", async () => {
      expect(await lib.erreursNavigateur(fA(), true)).toEqual({ restreint: true, navigateur: 0, sansSource: 0, serveur: 0 });
    });

    it("périmètre : B seule sous B ; viewer = A ; apps = [] → zéros", async () => {
      expect(await lib.erreursNavigateur(fB())).toMatchObject({ navigateur: 7, sansSource: 0, serveur: 0 });
      expect(await lib.erreursNavigateur(fViewer())).toEqual(await lib.erreursNavigateur(fA()));
      expect(await lib.erreursNavigateur(fVide())).toEqual({ restreint: true, navigateur: 0, sansSource: 0, serveur: 0 });
    });
  });

  describe("errorSeries", () => {
    it("occurrences par seau et par source, sur la grille ; seau vide = 0", async () => {
      const { restreint, points } = await lib.errorSeries(fA());
      expect(restreint).toBe(true);
      expect(points.map((p) => p.bucket)).toEqual(GRILLE);
      expect(points.map((p) => [p.navigateur, p.sansSource, p.serveur])).toEqual([
        [3, 0, 0],
        [0, 0, 5],
        [0, 0, 0],
        [1, 2, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]);
    });

    it("Σ seaux = totaux d'erreursNavigateur", async () => {
      const { points } = await lib.errorSeries(fA());
      const totaux = await lib.erreursNavigateur(fA());
      expect(points.reduce((s, p) => s + p.navigateur, 0)).toBe(totaux.navigateur);
      expect(points.reduce((s, p) => s + p.serveur, 0)).toBe(totaux.serveur);
    });

    it("shift et périmètre : période précédente vide ; viewer = A ; apps = [] → zéros", async () => {
      const avant = await lib.errorSeries(fA(), true);
      expect(avant.points.map((p) => p.bucket)).toEqual(GRILLE_PRECEDENTE);
      expect(await lib.errorSeries(fViewer())).toEqual(await lib.errorSeries(fA()));
      const vide = await lib.errorSeries(fVide());
      expect(vide.points).toHaveLength(6);
      expect(vide.points.every((p) => p.navigateur + p.sansSource + p.serveur === 0)).toBe(true);
    });
  });

  // ─────────────────────────── partSessionsTouchees ──────────────────────────

  describe("partSessionsTouchees", () => {
    it("une session touchée sans vue dans la fenêtre n'entre pas au numérateur", async () => {
      // base : a1, a2 ; a3 a une erreur dans la fenêtre mais aucune vue ; robot exclu.
      expect(await lib.partSessionsTouchees(fA())).toEqual({ base: 2, touchees: 1, tauxMin: 1 });
    });

    it("session sr = 0,1 / esr = 1 dans la base → tauxMin 0,1", async () => {
      expect(await lib.partSessionsTouchees(fB())).toEqual({ base: 2, touchees: 1, tauxMin: 0.1 });
    });

    it("session d'avant v58 dans la base → tauxMin null (même règle que samplingVitals), jamais 100 %", async () => {
      expect(await lib.partSessionsTouchees(f(`app=${C}`))).toEqual({ base: 1, touchees: 0, tauxMin: null });
    });

    it("ref : les occurrences du seul groupe, base resserrée sur son app", async () => {
      expect(await lib.partSessionsTouchees(f(""), { app_id: A, fingerprint: "fp-a1" })).toEqual({
        base: 2,
        touchees: 1,
        tauxMin: 1,
      });
      expect(await lib.partSessionsTouchees(fA(), { app_id: A, fingerprint: "fp-a3" })).toMatchObject({ touchees: 0 });
      // Un groupe d'une app HORS du périmètre du viewer : base vide, jamais un repli.
      expect(await lib.partSessionsTouchees(fViewer(), { app_id: B, fingerprint: "fp-b1" })).toEqual({
        base: 0,
        touchees: 0,
        tauxMin: null,
      });
    });

    it("part ≤ 100 % pour tout groupe semé", async () => {
      for (const [app, fp] of [[A, "fp-a1"], [A, "fp-a3"], [A, "fp-node"], [B, "fp-b1"]] as const) {
        const r = await lib.partSessionsTouchees(f(""), { app_id: app, fingerprint: fp });
        expect(r.touchees).toBeLessThanOrEqual(r.base);
      }
    });

    it("shift : a3 est dans la base précédente, sans erreur à cette période", async () => {
      expect(await lib.partSessionsTouchees(fA(), undefined, true)).toEqual({ base: 1, touchees: 0, tauxMin: 1 });
    });

    it("périmètre : viewer = A ; apps = [] et population vide → base 0, tauxMin null", async () => {
      expect(await lib.partSessionsTouchees(fViewer())).toEqual(await lib.partSessionsTouchees(fA()));
      expect(await lib.partSessionsTouchees(fVide())).toEqual({ base: 0, touchees: 0, tauxMin: null });
      expect(await lib.partSessionsTouchees(fMobile())).toEqual({ base: 0, touchees: 0, tauxMin: null });
    });
  });

  // ─────────────────────────────── samplingVitals ───────────────────────────────

  describe("samplingVitals", () => {
    it("minimum biaisé-erreurs des sessions porteuses d'une mesure", async () => {
      // b1 : 0,1 + 0,9 × 1 = 1 (en erreur) ; b2 : 0,5.
      expect(await lib.samplingVitals(fB())).toEqual({ probaMin: 0.5, sessions: 2, sansTaux: 0, biaiseErreurs: true });
    });

    it("une session d'avant v58 dans la population → probaMin null (jamais 100 %)", async () => {
      // a1 (1) et a5 (commencée en août) ; le robot est exclu.
      expect(await lib.samplingVitals(fA())).toEqual({ probaMin: null, sessions: 2, sansTaux: 1, biaiseErreurs: false });
    });

    it("périmètre : viewer = A ; apps = [] et population vide → 0 session, probaMin null", async () => {
      expect(await lib.samplingVitals(fViewer())).toEqual(await lib.samplingVitals(fA()));
      const vide = { probaMin: null, sessions: 0, sansTaux: 0, biaiseErreurs: false };
      expect(await lib.samplingVitals(fVide())).toEqual(vide);
      expect(await lib.samplingVitals(fMobile())).toEqual(vide);
    });
  });

  // ──────────────────────────── engagementStats(shift) ────────────────────────────

  describe("engagementStats (paramètre shift)", () => {
    it("sessions commencées sur la fenêtre, puis sur la période précédente", async () => {
      expect((await lib.engagementStats(fA())).sessions_started).toBe(2); // a1, a2 ; robot exclu
      expect((await lib.engagementStats(fA(), true)).sessions_started).toBe(1); // a3
    });

    it("périmètre : viewer = A ; apps = [] → 0", async () => {
      expect((await lib.engagementStats(fViewer())).sessions_started).toBe(2);
      expect((await lib.engagementStats(fVide(), true)).sessions_started).toBe(0);
    });
  });
});

// ═══════════════════ F18 — tuiles et hero de /errors ═══════════════════
//
// Une app à elle, semée dans le `beforeAll` du bloc : sept groupes, dont un RÉSOLU
// à 500 occurrences et un RÉGRESSÉ à 3. Le hero doit prendre les 4 plus fréquents
// de la fenêtre (le résolu en tête), pas les 4 premiers de la liste — rangée par
// triage, elle met le régressé en premier (CP9).
(url ? describe : describe.skip)("F18 — tuiles et hero de /errors sur PostgreSQL", () => {
  const APP_F18 = "f18-perf-a";
  const c18 = new pg.Client(url ? { connectionString: url } : {});
  let lib18: Console;
  const f18 = (qs = "") => lib18.filtersOfQuery(requete(`${FENETRE}&app=${APP_F18}${qs}`));
  const f18Vide = () => lib18.filtersOfQuery(sansApp(requete(`${FENETRE}&app=${APP_F18}`)));
  const PAGE = { limit: 100, offset: 0 };

  async function nettoyerF18(): Promise<void> {
    for (const table of ["rum_error", "rum_pageview", "rum_session", "error_status"]) {
      await c18.query(`delete from ${table} where app_id = $1`, [APP_F18]);
    }
  }

  async function semerF18(): Promise<void> {
    for (const [id, debut] of [["f18-s1", H(0, 1)], ["f18-s2", H(2, 1)], ["f18-s3", H(5, 1)]] as const) {
      await c18.query(
        `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at,
                                  sample_rate, error_sample_rate, has_error)
         values ($1, $2, 'desktop', false, $3, $3, 1, 1, true)`,
        [id, APP_F18, debut],
      );
      await c18.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, nav_type, started_at)
         values ($1, $2, $3, '/', 'https://site.example/', 'navigate', $4)`,
        [`${id}-pv`, id, APP_F18, debut],
      );
    }
    // [empreinte, session, occurrences, instant]
    const erreurs: [string, string | null, number, Date][] = [
      ["fp-resolu", "f18-s1", 500, H(1)],
      ["fp-regresse", "f18-s2", 3, H(4)],
      ["fp-g10", "f18-s1", 6, H(0)],
      ["fp-g10", "f18-s1", 4, H(3)],
      ["fp-g8", "f18-s2", 8, H(2)],
      ["fp-g6", "f18-s3", 6, H(5)],
      ["fp-g4", null, 4, H(5)], // sans session : sessions touchées inconnues pour ce groupe
      ["fp-ancien", null, 2, H(-3)], // période précédente : apparu À CE MOMENT-LÀ
      ["fp-ancien", "f18-s1", 1, H(1)],
    ];
    let n = 0;
    for (const [fp, sid, occ, ts] of erreurs) {
      await c18.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type,
                                fingerprint, occurrences, error_source, ts)
         values ($1, $2, $3, '/', 'error', $4, 'Error', $5, $6, 'browser_js', $7)`,
        [`f18-e-${n++}`, sid, APP_F18, `boom ${fp}`, fp, occ, ts],
      );
    }
    // Résolu APRÈS sa dernière occurrence : il reste résolu. Résolu AVANT : régressé.
    await c18.query(
      `insert into error_status (app_id, fingerprint, status, resolved_at) values ($1, 'fp-resolu', 'resolved', now()),
                                                                                ($1, 'fp-regresse', 'resolved', $2)`,
      [APP_F18, H(2)],
    );
  }

  beforeAll(async () => {
    await c18.connect();
    for (const file of fichiersSql()) await c18.query(readFileSync(file, "utf8"));
    await nettoyerF18();
    await semerF18();
    lib18 = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib18?.pool.end();
    await nettoyerF18();
    await c18.end();
  });

  describe("topGroupesSeries", () => {
    it("les 4 plus fréquents de la fenêtre : le résolu à 500 devant le régressé à 3", async () => {
      const { groupes } = await lib18.topGroupesSeries(f18(), 4);
      expect(groupes.map((g) => g.ref.fingerprint)).toEqual(["fp-resolu", "fp-g10", "fp-g8", "fp-g6"]);
      expect(groupes.map((g) => g.occurrences)).toEqual([500, 10, 8, 6]);
      expect(groupes[0]).toMatchObject({ ref: { app_id: APP_F18 }, message: "boom fp-resolu", error_type: "Error" });
    });

    it("séries sur la grille du contrat (6 seaux), zéros compris", async () => {
      const { groupes } = await lib18.topGroupesSeries(f18(), 4);
      expect(groupes.every((g) => g.series.length === GRILLE.length)).toBe(true);
      expect(groupes[1].series).toEqual([6, 0, 0, 4, 0, 0]);
      expect(groupes[0].series).toEqual([0, 500, 0, 0, 0, 0]);
    });

    it("hero : ≤ 5 séries, et « Autres » = tendance − Σ4 sur la même grille", async () => {
      const { groupes } = await lib18.topGroupesSeries(f18(), 4);
      const { trend, totals } = await lib18.totauxErreurs(f18());
      expect(groupes.length + 1).toBeLessThanOrEqual(5);
      const { autresGroupes } = await import("../../apps/console/lib/perf-domain");
      const tendance = trend.map((p) => p.occurrences);
      expect(tendance).toEqual([6, 501, 8, 4, 3, 10]);
      expect(tendance.reduce((a, b) => a + b, 0)).toBe(totals.occurrences);
      expect(autresGroupes(tendance, groupes.map((g) => g.series))).toEqual([0, 1, 0, 0, 3, 4]);
    });

    it("périmètre vide → aucun groupe", async () => {
      expect(await lib18.topGroupesSeries(f18Vide(), 4)).toEqual({ groupes: [] });
    });
  });

  describe("nouveauxGroupes", () => {
    it("groupes dont la première occurrence conservée est dans la fenêtre", async () => {
      expect(await lib18.nouveauxGroupes(f18())).toBe(6); // tous sauf fp-ancien, vu d'abord avant
    });

    it("shift : fp-ancien est apparu sur la période précédente", async () => {
      expect(await lib18.nouveauxGroupes(f18(), true)).toBe(1);
    });

    it("population filtrée (appareil absent) et périmètre vide → 0", async () => {
      expect(await lib18.nouveauxGroupes(f18("&device=mobile"))).toBe(0);
      expect(await lib18.nouveauxGroupes(f18Vide())).toBe(0);
    });

    it("= la liste `nouveaux=1`, qui écarte fp-ancien ; totaux et tendance de TOUTE la population", async () => {
      const liste = await lib18.listErrorGroups(f18(), PAGE, { nouveaux: true });
      expect(liste.groups.map((g) => g.fingerprint)).not.toContain("fp-ancien");
      expect(liste.groups).toHaveLength(await lib18.nouveauxGroupes(f18()));
      expect(liste.totals.occurrences).toBe(532);
    });
  });

  describe("totauxErreurs", () => {
    it("occurrences = sum(occurrences) ; sessions touchées distinctes", async () => {
      const { totals } = await lib18.totauxErreurs(f18());
      expect(totals.occurrences).toBe(532);
      expect(totals.sessions_affected).toBe(3);
      expect(totals.groups).toBe(7);
    });

    it("shift : la période précédente n'a qu'une occurrence sans session → sessions touchées inconnues (null), pas 0", async () => {
      const { totals, trend } = await lib18.totauxErreurs(f18(), true);
      expect(totals.occurrences).toBe(2);
      expect(totals.sessions_affected).toBeNull();
      expect(trend.map((p) => p.bucket.toISOString().replace(/\.\d{3}Z$/, "Z"))).toEqual(GRILLE_PRECEDENTE);
    });

    it("mêmes totaux que la liste", async () => {
      const liste = await lib18.listErrorGroups(f18(), PAGE);
      expect((await lib18.totauxErreurs(f18())).totals).toEqual(liste.totals);
    });
  });

  describe("ordre de la liste (tri)", () => {
    it("statut (défaut, inchangé) : le régressé d'abord, le résolu en dernier", async () => {
      const { groups } = await lib18.listErrorGroups(f18(), PAGE);
      expect(groups[0].fingerprint).toBe("fp-regresse");
      expect(groups.at(-1)?.fingerprint).toBe("fp-resolu");
    });

    it("sessions : un nombre de sessions inconnu (fp-g4) en dernier, jamais parmi les zéros", async () => {
      const { groups } = await lib18.listErrorGroups(f18(), PAGE, { tri: "sessions" });
      expect(groups.at(-1)?.fingerprint).toBe("fp-g4");
    });

    it("recent : dernière vue d'abord", async () => {
      const { groups } = await lib18.listErrorGroups(f18(), PAGE, { tri: "recent" });
      expect(groups.map((g) => g.fingerprint)).toEqual([
        "fp-g6",
        "fp-g4",
        "fp-regresse",
        "fp-g10",
        "fp-g8",
        "fp-resolu",
        "fp-ancien",
      ]);
    });
  });
});

// ═══════════════════ F22 — Interactions : tuiles et hero de /ux ═══════════════════
//
// Trois apps à ce bloc : une app navigateur (60 rage clicks sur 60 cibles : plus que
// les 50 couples de `topFrustrations`), une app aux seules sessions React Native (le
// capteur n'émet rien : non collecté), une app mixte (2 navigateur + 1 React Native :
// « 2 sur 3 », et le signal porté par la session React Native n'est pas compté).
(url ? describe : describe.skip)("F22 — frustrationTotaux et frustrationParRoute sur PostgreSQL", () => {
  const WEB_F22 = "f22-perf-web";
  const MOBILE_F22 = "f22-perf-mobile";
  const MIXTE_F22 = "f22-perf-mixte";
  const APPS_F22 = [WEB_F22, MOBILE_F22, MIXTE_F22];
  const c22 = new pg.Client(url ? { connectionString: url } : {});
  let lib22: Console;
  let frustration: typeof import("../../apps/console/lib/queries-frustration");
  const f22 = (app: string) => lib22.filtersOfQuery(requete(`${FENETRE}&app=${app}`));

  async function nettoyerF22(): Promise<void> {
    for (const table of ["rum_event", "rum_pageview", "rum_session"]) {
      await c22.query(`delete from ${table} where app_id = any($1::text[])`, [APPS_F22]);
    }
  }

  async function semerF22(): Promise<void> {
    // [session, app, runtime, début, routes vues]
    const sessions: [string, string, string | null, Date, string[]][] = [
      ["f22-w0", WEB_F22, "browser", H(-2), ["/panier"]], // période précédente
      ["f22-w1", WEB_F22, "browser", H(0, 5), ["/panier"]],
      ["f22-w2", WEB_F22, null, H(1, 5), ["/panier", "/"]], // runtime NULL : navigateur d'avant v82
      ["f22-w3", WEB_F22, "browser", H(2, 5), ["/"]],
      ["f22-m1", MOBILE_F22, "react_native", H(0, 5), ["Accueil"]],
      ["f22-m2", MOBILE_F22, "react_native", H(1, 5), ["Accueil"]],
      ["f22-m3", MOBILE_F22, "react_native", H(2, 5), ["Panier"]],
      ["f22-x1", MIXTE_F22, "browser", H(0, 5), ["/"]],
      ["f22-x2", MIXTE_F22, "browser", H(1, 5), ["/"]],
      ["f22-x3", MIXTE_F22, "react_native", H(2, 5), ["Accueil"]],
    ];
    for (const [id, app, runtime, debut, routes] of sessions) {
      await c22.query(
        `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, runtime)
         values ($1, $2, 'desktop', false, $3, $3, $4)`,
        [id, app, debut, runtime],
      );
      for (const [i, route] of routes.entries()) {
        await c22.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, url, nav_type, started_at)
           values ($1, $2, $3, $4, 'https://site.example/', 'navigate', $5)`,
          [`${id}-pv${i}`, id, app, route, new Date(debut.getTime() + i * 60_000)],
        );
      }
    }
    // [session, app, route, type, cible, instant]
    const signaux: [string, string, string, "rage" | "dead" | "error", string, Date][] = [
      ...Array.from({ length: 60 }, (_, i) => ["f22-w1", WEB_F22, "/panier", "rage", `bouton-${i}`, H(0, 20)] as const),
      ["f22-w2", WEB_F22, "/", "error", "payer", H(1, 20)],
      ["f22-w3", WEB_F22, "/", "dead", "lien-mort", H(2, 20)],
      ["f22-w0", WEB_F22, "/panier", "rage", "bouton-0", H(-2, 20)], // période précédente
      ["f22-x1", MIXTE_F22, "/", "rage", "menu", H(0, 20)],
      ["f22-x3", MIXTE_F22, "Accueil", "rage", "onglet", H(2, 20)], // porté par une session React Native
    ];
    for (const [n, [sid, app, route, type, cible, ts]] of signaux.entries()) {
      await c22.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [`f22-e-${n}`, sid, app, route, `frustration.${type}`, { target: cible, count: 1 }, ts],
      );
    }
  }

  beforeAll(async () => {
    await c22.connect();
    for (const file of fichiersSql()) await c22.query(readFileSync(file, "utf8"));
    await nettoyerF22();
    await semerF22();
    lib22 = await consoleSur(url!);
    frustration = await import("../../apps/console/lib/queries-frustration");
  }, 180_000);

  afterAll(async () => {
    await lib22?.pool.end();
    await nettoyerF22();
    await c22.end();
  });

  describe("frustrationTotaux", () => {
    it("total ENTIER : 60 rage clicks sur 60 cibles, là où `topFrustrations` s'arrête à 50 couples", async () => {
      const totaux = await frustration.frustrationTotaux(f22(WEB_F22));
      expect(totaux.parType).toEqual([
        { kind: "rage", n: 60, sessions: 1 },
        { kind: "dead", n: 1, sessions: 1 },
        { kind: "error", n: 1, sessions: 1 },
      ]);
      const top = await frustration.topFrustrations(f22(WEB_F22));
      expect(top.filter((r) => r.kind === "rage").reduce((s, r) => s + r.n, 0)).toBeLessThan(60);
    });

    it("base = sessions avec vue ; toutes couvertes (runtime browser ou NULL) ; sessions touchées de la base", async () => {
      const { capteur, baseTouchee } = await frustration.frustrationTotaux(f22(WEB_F22));
      expect(capteur).toEqual({ sessionsCouvertes: 3, sessionsTotal: 3, runtimeLu: true });
      expect(baseTouchee).toEqual({ tous: 3, rage: 1, dead: 1, error: 1 });
    });

    it("sessions React Native seules → sessionsCouvertes = 0 (le capteur n'émet pas), aucun signal", async () => {
      const totaux = await frustration.frustrationTotaux(f22(MOBILE_F22));
      expect(totaux.capteur).toEqual({ sessionsCouvertes: 0, sessionsTotal: 3, runtimeLu: true });
      expect(totaux.parType.every((t) => t.n === 0)).toBe(true);
    });

    it("mixte : 2 sessions couvertes sur 3 ; le signal porté par la session React Native n'est pas compté", async () => {
      const totaux = await frustration.frustrationTotaux(f22(MIXTE_F22));
      expect(totaux.capteur).toEqual({ sessionsCouvertes: 2, sessionsTotal: 3, runtimeLu: true });
      expect(totaux.parType.find((t) => t.kind === "rage")).toEqual({ kind: "rage", n: 1, sessions: 1 });
    });

    it("shift : la période précédente, sur sa propre base", async () => {
      const avant = await frustration.frustrationTotaux(f22(WEB_F22), true);
      expect(avant.parType.find((t) => t.kind === "rage")).toEqual({ kind: "rage", n: 1, sessions: 1 });
      expect(avant.capteur).toEqual({ sessionsCouvertes: 1, sessionsTotal: 1, runtimeLu: true });
    });
  });

  describe("frustrationParRoute", () => {
    it("par route : comptes par type, sessions de la route et sessions touchées SUR la route", async () => {
      const lignes = await frustration.frustrationParRoute(f22(WEB_F22));
      expect(lignes).toEqual([
        { route: "/", rage: 0, dead: 1, error: 1, sessionsTouchees: 2, sessionsRoute: 2 },
        { route: "/panier", rage: 60, dead: 0, error: 0, sessionsTouchees: 1, sessionsRoute: 2 },
      ]);
    });

    it("numérateur inclus dans le dénominateur : touchées ≤ sessions de la route, partout", async () => {
      for (const app of APPS_F22) {
        for (const l of await frustration.frustrationParRoute(f22(app))) {
          expect(l.sessionsTouchees).toBeLessThanOrEqual(l.sessionsRoute);
        }
      }
    });

    it("type=rage : seuls les rage clicks comptent", async () => {
      const lignes = await frustration.frustrationParRoute(f22(WEB_F22), "rage");
      expect(lignes.find((l) => l.route === "/")).toEqual({
        route: "/",
        rage: 0,
        dead: 0,
        error: 0,
        sessionsTouchees: 0,
        sessionsRoute: 2,
      });
      expect(lignes.find((l) => l.route === "/panier")).toMatchObject({ rage: 60, sessionsTouchees: 1 });
    });

    it("les sessions React Native sortent des deux côtés : aucune route mobile dans le classement", async () => {
      expect(await frustration.frustrationParRoute(f22(MOBILE_F22))).toEqual([]);
      const mixte = await frustration.frustrationParRoute(f22(MIXTE_F22));
      expect(mixte).toEqual([{ route: "/", rage: 1, dead: 0, error: 0, sessionsTouchees: 1, sessionsRoute: 2 }]);
    });
  });
});
