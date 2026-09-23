// F39 — `mobileSerie` : « Sessions et erreurs JS dans le temps » de `/mobile`,
// prouvée sur PostgreSQL réel (même style que rum-mobile-par-release-sql.test.ts).
//
// CE QUE LE TEST PROUVE. Que la série découpe EXACTEMENT la cohorte des tuiles :
// la somme des seaux de sessions est `mobileSummary().sessions.sessions`, celle des
// occurrences `mobileSummary().js_errors.occurrences` — robots, navigateurs,
// sessions commencées avant la fenêtre, erreurs d'une autre source et autres apps
// exclus ; que chaque seau attendu existe (zéros compris) ; que la release se lit
// sur la session ; que le périmètre tient (viewer restreint, `apps = []`) ; et que
// l'Explorer, sur `seg=v2:runtime:eq:react_native` (B8), rejoue le panneau des
// sessions seau pour seau ; enfin que l'écran lit tuiles et série dans UNE
// photographie (`mobileResumeEtSerie`, revue de fin de vague 8).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExplorerPlan } from "../../apps/console/lib/analytics-schema";
import type { FiltersLike } from "../../apps/console/lib/filters";
import {
  intersectApp,
  intersectQuery,
  parseAnalyticsQuery,
  type AnalyticsQuery,
  type ScopePrincipal,
} from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const APP_F39 = "f39-serie-a";
const APP_F39_B = "f39-serie-b";
const APPS_F39 = [APP_F39, APP_F39_B];
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

// Trois heures pleines, terminées : trois seaux d'une heure (`bucketSecondsFor`).
const H = 3_600_000;
const TO = new Date(Math.floor(Date.now() / H) * H - H);
const FROM = new Date(TO.getTime() - 3 * H);
const dans = (heure: number, minutes: number) => new Date(FROM.getTime() + heure * H + minutes * 60_000);

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  return [join(SQL_DIR, "schema.sql"), ...migrations.map((f) => join(SQL_DIR, f))];
}

/** Modules console branchés sur la base jetable (voir rum-mobile-p75-sql.test.ts). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const mobile = await import("../../apps/console/lib/queries-mobile");
  const explorer = await import("../../apps/console/lib/queries-explorer");
  const filters = await import("../../apps/console/lib/filters");
  const analytics = await import("../../apps/console/lib/analytics-schema");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  schema.forgetDimensionSchema();
  return { ...mobile, ...explorer, ...filters, analytics, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

async function nettoyerF39(c: pg.Client) {
  for (const table of ["mobile_capabilities", "rum_error", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS_F39]);
  }
}

/**
 * Cohorte de A : 2 sessions React Native commencées dans le seau 0 (iOS, 4.2), 1 dans
 * le seau 2 (Android, 4.1), aucune dans le seau 1. Bruit : une session web, un robot
 * React Native, une session React Native commencée AVANT la fenêtre (avec une erreur
 * dans la fenêtre), une erreur navigateur sur une session React Native, une session
 * React Native de l'app B avec son erreur.
 */
async function semerF39(c: pg.Client) {
  for (const app of APPS_F39) {
    await c.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
  const session = (id: string, runtime: string, os: string, release: string, debut: Date, bot = false, app = APP_F39) =>
    c.query(
      `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id, is_bot, started_at, last_seen_at)
       values ($1,$2,'mobile',$3,$4,$5,$1,$6,$7::timestamptz,$7::timestamptz + interval '2 minutes')`,
      [id, app, os, runtime, release, bot, debut],
    );
  await session("f39-rn-1", "react_native", "iOS", "4.2", dans(0, 5));
  await session("f39-rn-2", "react_native", "iOS", "4.2", dans(0, 40));
  await session("f39-rn-3", "react_native", "Android", "4.1", dans(2, 10));
  await session("f39-web", "browser", "Windows", "4.2", dans(0, 10));
  await session("f39-bot", "react_native", "iOS", "4.2", dans(1, 10), true);
  await session("f39-avant", "react_native", "iOS", "4.2", new Date(FROM.getTime() - 10 * 60_000));
  await session("f39-b-rn", "react_native", "iOS", "4.2", dans(0, 20), false, APP_F39_B);

  const erreur = (span: string, sessionId: string, source: string, occ: number, ts: Date, app = APP_F39) =>
    c.query(
      `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, ts)
       values ($1,$2,$3,'incident','crash',$4,$5,$6)`,
      [span, sessionId, app, occ, source, ts],
    );
  // Cohorte : 2 + 1 occurrences (seaux 0 et 1, même session), 4 dans le seau 2.
  await erreur("f39-e1", "f39-rn-1", "react_native_js", 2, dans(0, 6));
  await erreur("f39-e2", "f39-rn-1", "react_native_js", 1, dans(1, 1));
  await erreur("f39-e3", "f39-rn-3", "react_native_js", 4, dans(2, 11));
  // Bruit : autre source, navigateur, robot, session d'avant la fenêtre, autre app.
  await erreur("f39-e4", "f39-rn-2", "browser_js", 30, dans(0, 41));
  await erreur("f39-e5", "f39-web", "browser_js", 50, dans(0, 11));
  await erreur("f39-e6", "f39-bot", "react_native_js", 60, dans(1, 11));
  await erreur("f39-e7", "f39-avant", "react_native_js", 70, dans(0, 1));
  await erreur("f39-e8", "f39-b-rn", "react_native_js", 80, dans(0, 21), APP_F39_B);

  await c.query(
    `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
     values ($1,'react_native','4.2','js_errors',true)`,
    [APP_F39],
  );
}

suite("F39 — mobileSerie sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  const requete = (qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery => {
    const params = new URLSearchParams(qs);
    params.set("from", FROM.toISOString());
    params.set("to", TO.toISOString());
    const parsed = parseAnalyticsQuery(params, { principal, nowMs: Date.now() });
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  };
  const filtres = (q: AnalyticsQuery): FiltersLike => lib.filtersOfQuery(q);

  const serie = async (q: AnalyticsQuery) => {
    const r = await lib.mobileSerie(filtres(q));
    if (!r.disponible) throw new Error(`indisponible : ${r.raison}`);
    return r;
  };
  const sessionsParSeau = (r: Awaited<ReturnType<typeof serie>>) => r.seaux.map((s) => s.sessions);
  const occurrencesParSeau = (r: Awaited<ReturnType<typeof serie>>) => r.seaux.map((s) => s.occurrences);

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyerF39(c);
    await semerF39(c);
    lib = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyerF39(c);
    await c.query("delete from app_registry where app_id = any($1::text[])", [APPS_F39]);
    await c.end();
  });

  it("un seau par début attendu, zéros compris ; la cohorte seule", async () => {
    const r = await serie(requete(`app=${APP_F39}`));
    expect(r.seaux.map((s) => Date.parse(String(s.bucket)))).toEqual([0, 1, 2].map((h) => FROM.getTime() + h * H));
    expect(sessionsParSeau(r)).toEqual([2, 0, 1]);
    expect(occurrencesParSeau(r)).toEqual([2, 1, 4]);
    expect(r.raisonErreurs).toBeNull();
  });

  it("la somme des seaux est la tuile : sessions et occurrences de `mobileSummary`", async () => {
    for (const qs of [`app=${APP_F39}`, `app=${APP_F39}&os=iOS`, `app=${APP_F39}&release=4.1`]) {
      const q = requete(qs);
      const [r, resume] = await Promise.all([serie(q), lib.mobileSummary(filtres(q))]);
      expect(sessionsParSeau(r).reduce((a, b) => a + b, 0), qs).toBe(resume.sessions.sessions);
      expect(occurrencesParSeau(r).reduce((a, b) => a + (b ?? 0), 0), qs).toBe(resume.js_errors?.occurrences);
    }
  });

  it("la release se lit sur la SESSION ; le système aussi", async () => {
    const v41 = await serie(requete(`app=${APP_F39}&release=4.1`));
    expect(sessionsParSeau(v41)).toEqual([0, 0, 1]);
    expect(occurrencesParSeau(v41)).toEqual([0, 0, 4]);
    const ios = await serie(requete(`app=${APP_F39}&os=iOS`));
    expect(sessionsParSeau(ios)).toEqual([2, 0, 0]);
    expect(occurrencesParSeau(ios)).toEqual([2, 1, 0]);
  });

  it("robots inclus : le robot React Native entre, avec ses occurrences", async () => {
    const r = await serie(requete(`app=${APP_F39}&bots=1`));
    expect(sessionsParSeau(r)).toEqual([2, 1, 1]);
    expect(occurrencesParSeau(r)).toEqual([2, 61, 4]);
  });

  describe("périmètre", () => {
    it("viewer restreint à A sous « toutes ses apps » : A seulement ; à A et B : les deux", async () => {
      const a = await serie(requete("", { role: "viewer", apps: [APP_F39] }));
      expect(sessionsParSeau(a)).toEqual([2, 0, 1]);
      const ab = await serie(requete("", { role: "viewer", apps: APPS_F39 }));
      expect(sessionsParSeau(ab)).toEqual([3, 0, 1]);
      expect(occurrencesParSeau(ab)).toEqual([82, 1, 4]);
    });

    it("périmètre effectif vide : tous les seaux à zéro, jamais les chiffres d'une autre app", async () => {
      const vide = intersectApp(requete(`app=${APP_F39}`, { role: "viewer", apps: [APP_F39] }), APP_F39_B);
      expect(vide.scope.effectiveApps).toEqual([]);
      const r = await serie(vide);
      expect(sessionsParSeau(r)).toEqual([0, 0, 0]);
      expect(occurrencesParSeau(r)).toEqual([0, 0, 0]);
    });
  });

  it("B8 : l'Explorer sur `seg=v2:runtime:eq:react_native` rejoue le panneau des sessions, seau pour seau", async () => {
    const q = requete(`app=${APP_F39}&os=iOS`);
    const plan: ExplorerPlan = {
      version: lib.analytics.EXPLORER_VERSION,
      dataset: "sessions",
      measure: { field: "started", aggregation: "count" },
      variant: null,
      groupBy: [],
      visualization: "timeseries",
      limit: 10,
      cursor: null,
    };
    const rn = intersectQuery(q, { conditions: [{ dimension: "runtime", operator: "eq", value: "react_native" }] });
    const [r, explore] = await Promise.all([serie(q), lib.exploreAnalytics({ query: rn, plan })]);
    const parSeau = new Map(explore.data.series.map((p) => [Date.parse(p.start), p.value ?? 0]));
    expect(r.seaux.map((s) => parSeau.get(Date.parse(String(s.bucket))) ?? 0)).toEqual(sessionsParSeau(r));
    expect(explore.data.total).toBe(2);
  });

  // Revue de fin de vague 8, constat 6. `mobileSerie` et `mobileSummary`, lancées
  // côte à côte, ouvraient DEUX transactions : une session reçue entre les deux
  // entrait dans l'une et pas dans l'autre, et « la somme des seaux est la tuile »
  // devenait fausse. On arrête la lecture de l'écran ENTRE les tuiles et la série
  // (un verrou sur `rum_span`, que seule la dernière instruction du résumé lit), on
  // valide une session React Native à ce moment-là, puis on relâche.
  it("tuiles et série dans UNE photographie : une session reçue pendant la lecture n'entre dans aucune des deux", async () => {
    const q = requete(`app=${APP_F39}`);
    const verrou = new pg.Client({ connectionString: url });
    await verrou.connect();
    try {
      await verrou.query("begin");
      await verrou.query("lock table rum_span in access exclusive mode");
      const lecture = lib.mobileResumeEtSerie(filtres(q));
      // La photographie est prise (sessions, erreurs, démarrage, écrans lus) quand la
      // lecture attend le verrou de `rum_span`.
      await vi.waitFor(
        async () => {
          const { rows } = await c.query<{ n: number }>(
            "select count(*)::int as n from pg_locks where not granted and relation = 'rum_span'::regclass",
          );
          if (rows[0].n < 1) throw new Error("lecture pas encore arrêtée sur rum_span");
        },
        { timeout: 15_000, interval: 25 },
      );
      await c.query(
        `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id, is_bot, started_at, last_seen_at)
         values ('f39-pendant',$1,'mobile','iOS','react_native','4.2','f39-pendant',false,$2::timestamptz,$2::timestamptz + interval '2 minutes')`,
        [APP_F39, dans(0, 30)],
      );
      await verrou.query("commit");

      const { resume, serie: lue } = await lecture;
      const tuile = lib.valeurDe(resume).sessions.sessions;
      const s = lib.valeurDe(lue);
      if (!s.disponible) throw new Error(`indisponible : ${s.raison}`);
      expect(tuile).toBe(3);
      expect(s.seaux.reduce((n, x) => n + x.sessions, 0)).toBe(tuile);
      // Hors de cette photographie, la session est bien là : une série lue dans sa
      // propre transaction, après, l'aurait comptée (4 contre 3 à la tuile).
      expect(sessionsParSeau(await serie(q))).toEqual([3, 0, 1]);
    } finally {
      await verrou.query("rollback").catch(() => {});
      await verrou.end();
      await c.query("delete from rum_session where session_id = 'f39-pendant'");
    }
  });
});
