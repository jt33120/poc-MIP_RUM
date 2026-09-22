// F40 — échantillonnage de la population des écrans d'usage (B38, règle S7), sur un
// vrai PostgreSQL.
//
// Le test unitaire verrouille les TEXTES du bandeau ; seule la base dit que les
// lectures comptent la BONNE population : celle que l'écran affiche, sur son
// périmètre d'apps et lui seul, bots exclus, avec la probabilité d'inclusion
// biaisée-erreurs de migration-v58 (`sr + (1 − sr) × esr` pour une session en
// erreur) et les sessions d'avant v58 comptées « sans taux », jamais à 100 %.
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

const A = "f40-ech-a";
const B = "f40-ech-b";
const APPS = [A, B];

const HEURE = 3_600_000;
const NOW = Date.now();
const IL_Y_A = (ms: number) => new Date(NOW - ms);
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
  for (const table of ["rum_span", "rum_event", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

interface Session {
  id: string;
  app: string;
  debut: Date;
  fin: Date;
  sr: number;
  esr: number;
  erreur: boolean;
  visiteur: string | null;
  bot?: boolean;
}

async function semer(c: pg.Client): Promise<void> {
  const sessions: Session[] = [
    // A, échantillonnée à 50 %, sans erreur : p = 0,5.
    { id: "f40-a1", app: A, debut: IL_Y_A(HEURE), fin: IL_Y_A(HEURE / 2), sr: 0.5, esr: 1, erreur: false, visiteur: "f40-v1" },
    // A, à 20 % mais EN ERREUR, promue par esr = 1 : p = 0,2 + 0,8 × 1 = 1.
    { id: "f40-a2", app: A, debut: IL_Y_A(HEURE / 2), fin: IL_Y_A(HEURE / 4), sr: 0.2, esr: 1, erreur: true, visiteur: null },
    // A, commencée avant v58 et encore active : taux non enregistré (sample_rate = 1 par défaut).
    { id: "f40-a3", app: A, debut: AOUT, fin: IL_Y_A(HEURE), sr: 1, esr: 1, erreur: false, visiteur: "f40-v3" },
    // A, un robot très échantillonné : exclu des populations (bots exclus par défaut).
    { id: "f40-a4", app: A, debut: IL_Y_A(HEURE), fin: IL_Y_A(HEURE), sr: 0.01, esr: 0, erreur: false, visiteur: "f40-v4", bot: true },
    // B, à 10 % : ne doit JAMAIS entrer dans une population de A.
    { id: "f40-b1", app: B, debut: IL_Y_A(HEURE), fin: IL_Y_A(HEURE / 2), sr: 0.1, esr: 0, erreur: false, visiteur: "f40-vb" },
  ];
  for (const s of sessions) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at,
                                sample_rate, error_sample_rate, has_error, visitor_id)
       values ($1, $2, 'desktop', $3, $4, $5, $6, $7, $8, $9)`,
      [s.id, s.app, s.bot ?? false, s.debut, s.fin, s.sr, s.esr, s.erreur, s.visiteur],
    );
  }
  // Pages vues (population « vues » : acquisition, parcours) : a1, a3, a4 (robot), b1.
  for (const [span, sid, app] of [
    ["f40-pv-a1", "f40-a1", A],
    ["f40-pv-a3", "f40-a3", A],
    ["f40-pv-a4", "f40-a4", A],
    ["f40-pv-b1", "f40-b1", B],
  ]) {
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
       values ($1, $2, $3, '/', 'https://site.example/', null, $4)`,
      [span, sid, app, IL_Y_A(HEURE / 2)],
    );
  }
  // Formulaires : a2 seulement (et b1).
  for (const [span, sid, app] of [
    ["f40-ev-a2", "f40-a2", A],
    ["f40-ev-b1", "f40-b1", B],
  ]) {
    await c.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ($1, $2, $3, '/', 'form.submit', '{"form":"contact"}'::jsonb, $4)`,
      [span, sid, app, IL_Y_A(HEURE / 4)],
    );
  }
  // Spans : a1 a un span FRONT ; a2 n'a qu'un span BACK (pas dans la population de la carte).
  for (const [span, sid, app, tier] of [
    ["f40-sp-a1", "f40-a1", A, "front"],
    ["f40-sp-a2", "f40-a2", A, "back"],
    ["f40-sp-b1", "f40-b1", B, "front"],
  ]) {
    await c.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, duration_ms, status_code, ts)
       values ($1, $1, $2, $3, $4, '/api/x', 120, 200, $5)`,
      [span, tier, sid, app, IL_Y_A(HEURE / 2)],
    );
  }
}

/** Modules console branchés sur la base jetable (cf. comparaison-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const sessions = await import("../../apps/console/lib/queries-sessions");
  const { acquisition } = await import("../../apps/console/lib/queries-acquisition");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...sessions, acquisition, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

const ADMIN: ScopePrincipal = { role: "admin", apps: null };
const VIEWER_A: ScopePrincipal = { role: "viewer", apps: [A] };

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

(url ? describe : describe.skip)("échantillonnage des populations d'usage sur PostgreSQL (B38)", () => {
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

  describe("samplingSessions (contrat : /sessions)", () => {
    it("sessions commencées OU actives : minimum biaisé-erreurs, session d'avant v58 comptée sans taux, robot exclu", async () => {
      expect(await lib.samplingSessions(f(`app=${A}&period=24h`))).toEqual({
        probaMin: 0.5, // a1 ; a2 est en erreur donc p = 1 ; a3 vaut 1 par défaut
        sessions: 3, // a1, a2 commencées ; a3 active (commencée en août) ; a4 est un robot
        sansTaux: 1, // a3
        biaiseErreurs: true, // a1 et a2 : sr < 1 et esr > 0
      });
    });

    it("le périmètre décide : B n'entre pas sous app=A ; il entre sous « toutes » pour un admin", async () => {
      expect((await lib.samplingSessions(f(`app=${A}&period=24h`))).probaMin).toBe(0.5);
      const tout = await lib.samplingSessions(f("period=24h"));
      expect(tout.probaMin).toBeLessThanOrEqual(0.1); // b1 à 10 %, et d'autres apps éventuelles de la base
      expect(tout.sessions).toBeGreaterThanOrEqual(4);
    });

    it("viewer restreint à A sous « toutes ses apps » : apps effectives liées, B jamais lue", async () => {
      expect(await lib.samplingSessions(f("period=24h", VIEWER_A))).toMatchObject({ probaMin: 0.5, sessions: 3 });
    });

    it("robots inclus sur demande : le robot à 1 % abaisse le minimum", async () => {
      expect((await lib.samplingSessions(f(`app=${A}&period=24h&bots=1`))).probaMin).toBeCloseTo(0.01);
    });

    it("population vide (appareil absent) : 0 session, probabilité null — pas 100 %", async () => {
      expect(await lib.samplingSessions(f(`app=${A}&period=24h&device=mobile`))).toEqual({
        probaMin: null,
        sessions: 0,
        sansTaux: 0,
        biaiseErreurs: false,
      });
    });

    it("avecSpans (/map) : seules les sessions portant un span FRONT dans la fenêtre", async () => {
      expect(await lib.samplingSessions(f(`app=${A}&period=24h`), { avecSpans: true })).toEqual({
        probaMin: 0.5,
        sessions: 1, // a1 ; a2 n'a qu'un span serveur
        sansTaux: 0,
        biaiseErreurs: true,
      });
    });
  });

  describe("samplingSessionsHistorique (écrans non migrés)", () => {
    it("vues (/acquisition, /paths) : sessions ayant une page vue sur la période glissante", async () => {
      expect(await lib.samplingSessionsHistorique(f(`app=${A}&period=24h`), { lecture: "vues" })).toEqual({
        probaMin: 0.5,
        sessions: 2, // a1, a3 ; le robot a4 exclu
        sansTaux: 1,
        biaiseErreurs: true,
      });
    });

    it("formulaires (/forms) : a2 seule, en erreur donc p = 1 — rien d'échantillonné pour cette population", async () => {
      expect(await lib.samplingSessionsHistorique(f(`app=${A}&period=24h`), { lecture: "formulaires" })).toEqual({
        probaMin: 1,
        sessions: 1,
        sansTaux: 0,
        biaiseErreurs: true,
      });
    });

    it("cohortes (/retention) : sessions identifiées des N dernières semaines", async () => {
      // a1 (identifiée, récente) ; a2 sans identifiant ; a3 commencée en août, hors 4 semaines.
      expect(await lib.samplingSessionsHistorique(f(`app=${A}`), { lecture: "cohortes", semaines: 4 })).toMatchObject({
        probaMin: 0.5,
        sessions: 1,
        sansTaux: 0,
      });
    });

    it("le périmètre d'apps est lié par les apps effectives : B n'entre jamais sous app=A", async () => {
      const a = await lib.samplingSessionsHistorique(f(`app=${A}&period=24h`), { lecture: "vues" });
      expect(a.probaMin).toBe(0.5);
      const tout = await lib.samplingSessionsHistorique(f("period=24h"), { lecture: "vues" });
      expect(tout.probaMin).toBeLessThanOrEqual(0.1);
      const viewer = await lib.samplingSessionsHistorique(f("period=24h", VIEWER_A), { lecture: "vues" });
      expect(viewer).toMatchObject({ probaMin: 0.5, sessions: 2 });
    });

    it("jointure sur (app_id, session_id) : une ligne de A qui cite une session de B n'emporte pas B", async () => {
      // `session_id` seul ne désigne pas une session : une page vue et un envoi de
      // formulaire de A portant l'identifiant de la session b1 (échantillonnée à
      // 10 %) ne doivent ni l'ajouter à la population de A, ni abaisser son minimum.
      await c.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
         values ('f40-pv-croise', 'f40-b1', $1, '/', 'https://site.example/', null, $2)`,
        [A, IL_Y_A(HEURE / 2)],
      );
      await c.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
         values ('f40-ev-croise', 'f40-b1', $1, '/', 'form.submit', '{"form":"contact"}'::jsonb, $2)`,
        [A, IL_Y_A(HEURE / 4)],
      );
      try {
        expect(await lib.samplingSessionsHistorique(f(`app=${A}&period=24h`), { lecture: "vues" })).toMatchObject({
          probaMin: 0.5,
          sessions: 2,
        });
        expect(await lib.samplingSessionsHistorique(f(`app=${A}&period=24h`), { lecture: "formulaires" })).toMatchObject({
          probaMin: 1,
          sessions: 1,
        });
      } finally {
        await c.query(`delete from rum_pageview where span_id = 'f40-pv-croise'`);
        await c.query(`delete from rum_event where span_id = 'f40-ev-croise'`);
      }
    });

    it("mêmes filtres que la lecture qualifiée : appareil et segment v1", async () => {
      expect((await lib.samplingSessionsHistorique(f(`app=${A}&period=24h&device=mobile`), { lecture: "vues" })).sessions).toBe(0);
      expect((await lib.samplingSessionsHistorique(f(`app=${A}&period=24h&seg=device==desktop`), { lecture: "vues" })).sessions).toBe(2);
    });

    it("/acquisition sous un segment v1 : la lecture aboutit, sur la même population que « vues »", async () => {
      // `$3` était déjà `cap` (limit) : le segment, compilé à partir de `$3`, liait sa
      // valeur au mauvais paramètre et PostgreSQL refusait la requête.
      expect((await lib.acquisition(f(`app=${A}&period=24h&seg=device==desktop`))).total).toBe(2);
      expect((await lib.acquisition(f(`app=${A}&period=24h&seg=device==mobile`))).total).toBe(0);
      expect((await lib.acquisition(f(`app=${A}&period=24h&seg=device==desktop`), 1)).total).toBe(1);
    });

    it("une fenêtre de semaines hors bornes est refusée, jamais interpolée", async () => {
      await expect(lib.samplingSessionsHistorique(f(`app=${A}`), { lecture: "cohortes", semaines: 0 })).rejects.toThrow(
        "fenêtre de rétention invalide",
      );
    });
  });
});
