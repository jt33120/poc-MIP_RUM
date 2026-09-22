// F38 — `mobileParRelease` : la stabilité par release de `/mobile`, prouvée sur
// PostgreSQL réel (même style que rum-mobile-p75-sql.test.ts).
//
// CE QUE LE TEST PROUVE. Qu'une release qui ne déclare pas collecter les erreurs
// JS n'a pas de pourcentage (et non « 0 % »), même quand une autre release du parc
// déclare ; que les sessions sans release forment la ligne « Inconnue » ; que les
// occurrences sont une SOMME, pas un compte de lignes ; que la référence porte sur
// toutes les releases, pas sur celles affichées ; et que la coupe se refuse, avec
// sa raison, sur un schéma qui ne la permet pas.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FiltersLike } from "../../apps/console/lib/filters";
import { parseAnalyticsQuery, type AnalyticsQuery } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const APP = "f38-par-release";
/** Seconde app React Native, qui publie AUSSI une « 1.4 » et ne déclare rien. */
const APP_B = "f38-par-release-b";
const APPS = [APP, APP_B];

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
  const capacites = await import("../../apps/console/lib/mobile-capabilities");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  schema.forgetDimensionSchema();
  return { ...mobile, capacites, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

function requete(dimensions: Record<string, string> = {}): AnalyticsQuery {
  const sp = new URLSearchParams({ app: APP, period: "24h", ...dimensions });
  const parsed = parseAnalyticsQuery(sp, { principal: { role: "admin", apps: null }, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

const filtres = (dimensions: Record<string, string> = {}): FiltersLike => ({
  app: APP,
  period: "24h",
  device: null,
  segment: [],
  includeBots: false,
  includeInternal: false,
  query: requete(dimensions),
});

async function nettoyer(c: pg.Client) {
  for (const table of ["mobile_capabilities", "rum_event", "rum_error", "rum_pageview", "rum_session"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

/** Les deux apps à la fois (`app=all` d'un principal qui les lit toutes deux), 24 h. */
function filtresDeuxApps(): FiltersLike {
  const q = requete();
  return {
    ...filtres(),
    app: null,
    query: { ...q, scope: { requestedApp: null, authorizedApps: APPS, effectiveApps: APPS } },
  };
}

/**
 * Jeu : 1.4 déclare `js_errors` (3 sessions dont 1 touchée, par DEUX lignes
 * d'erreur de 3 et 4 occurrences), 1.2 ne déclare rien (2 sessions sans erreur),
 * une session sans release. Bruit : une session web en 1.4 avec son erreur, un
 * robot React Native en 1.4 avec la sienne.
 */
async function semer(c: pg.Client) {
  for (const app of APPS) {
    await c.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
  const session = (id: string, runtime: string, release: string | null, ageMin: number, bot = false, app = APP) =>
    c.query(
      `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id, is_bot,
                                started_at, last_seen_at)
       values ($1,$2,'mobile','iOS',$3,$4,$1,$5, now() - ($6::int * interval '1 minute'),
               now() - ($6::int * interval '1 minute') + interval '2 minutes')`,
      [id, app, runtime, release, bot, ageMin],
    );
  await session("f38-14-a", "react_native", "1.4", 30);
  await session("f38-14-b", "react_native", "1.4", 20);
  await session("f38-14-c", "react_native", "1.4", 10);
  await session("f38-12-a", "react_native", "1.2", 60);
  await session("f38-12-b", "react_native", "1.2", 50);
  await session("f38-sans", "react_native", null, 40);
  await session("f38-web", "browser", "1.4", 15);
  await session("f38-bot", "react_native", "1.4", 12, true);
  // App B : une « 1.4 » homonyme (2 sessions, dont 1 touchée) et une « 1.3 » dont la
  // première session tombe ENTRE la 1.4 et la 1.2 de A. B ne déclare rien.
  await session("f38-b-14-a", "react_native", "1.4", 25, false, APP_B);
  await session("f38-b-14-b", "react_native", "1.4", 24, false, APP_B);
  await session("f38-b-13-a", "react_native", "1.3", 45, false, APP_B);

  const erreur = (span: string, sessionId: string, source: string, occ: number, ageMin: number, app = APP) =>
    c.query(
      `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, ts)
       values ($1,$2,$3,'incident','crash',$4,$5, now() - ($6::int * interval '1 minute'))`,
      [span, sessionId, app, occ, source, ageMin],
    );
  await erreur("f38-e1", "f38-14-a", "react_native_js", 3, 29);
  await erreur("f38-e2", "f38-14-a", "react_native_js", 4, 28);
  await erreur("f38-e3", "f38-web", "browser_js", 50, 14);
  await erreur("f38-e4", "f38-bot", "react_native_js", 60, 11);
  await erreur("f38-e5", "f38-b-14-a", "react_native_js", 2, 24, APP_B);

  await c.query(
    `insert into rum_event (span_id, session_id, app_id, name, event_type, timing_ms, ts) values
       ('f38-t1','f38-14-a',$1,'js_start_to_first_screen_ms','timing',700, now() - interval '30 minutes'),
       ('f38-t2','f38-14-b',$1,'js_start_to_first_screen_ms','timing',900, now() - interval '20 minutes'),
       ('f38-t3','f38-14-b',$1,'js_warm_start_to_first_screen_ms','timing',100, now() - interval '19 minutes')`,
    [APP],
  );

  await c.query(
    `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
     values ($1,'react_native','1.4','js_errors',true)`,
    [APP],
  );
}

suite("F38 — mobileParRelease sur PostgreSQL", () => {
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
    await c.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
    await c.end();
  });

  const disponible = async (f: FiltersLike, limite?: number) => {
    const r = await lib.mobileParRelease(f, limite);
    if (!r.disponible) throw new Error(`indisponible : ${r.raison}`);
    return r;
  };

  it("deux releases, une seule déclarante : pas de pourcentage sur la seconde", async () => {
    const r = await disponible(filtres());
    const v14 = r.lignes.find((l) => l.release === "1.4")!;
    const v12 = r.lignes.find((l) => l.release === "1.2")!;
    // 1.4 : 1 session touchée sur 3 (robot et web exclus).
    expect(v14).toMatchObject({ sessions: 3, sessions_touchees: 1, etat_js_errors: "active", raison_part: null });
    expect(v14.part_touchee).toBeCloseTo(1 / 3, 10);
    // 1.2 : aucune déclaration → part null et la raison, jamais 0 %.
    expect(v12).toMatchObject({
      sessions: 2,
      etat_js_errors: "unknown",
      part_touchee: null,
      raison_part: lib.capacites.ERROR_FREE_REASONS.capability_unknown,
    });
  });

  it("la release null est une ligne à part, « Inconnue » à l'écran, sans état hérité", async () => {
    const r = await disponible(filtres());
    const inconnue = r.lignes.find((l) => l.release === null)!;
    expect(inconnue).toMatchObject({ sessions: 1, etat_js_errors: "unknown", part_touchee: null });
    expect(r.releases).toBe(3);
    expect(r.tronque).toBe(false);
  });

  it("somme des occurrences, pas des lignes ; le démarrage à froid par release, avec son n", async () => {
    const r = await disponible(filtres());
    const v14 = r.lignes.find((l) => l.release === "1.4")!;
    // Deux lignes d'erreur, 3 + 4 occurrences ; les 50 du web et les 60 du robot sont dehors.
    expect(v14.occurrences).toBe(7);
    expect(v14.demarrage_froid_n).toBe(2);
    expect(v14.demarrage_froid_p75_ms).toBeCloseTo(850, 5);
    expect(r.lignes.find((l) => l.release === "1.2")).toMatchObject({ demarrage_froid_p75_ms: null, demarrage_froid_n: 0 });
  });

  it("ordre par première session vue, la plus récente en tête ; écart contre la précédente", async () => {
    const r = await disponible(filtres());
    expect(r.lignes.map((l) => l.release)).toEqual(["1.4", null, "1.2"]);
    const v14 = r.lignes[0];
    // La précédente de 1.4 est 1.2 (la ligne sans release ne compte pas) ; sa part est
    // null, donc pas d'écart.
    expect(v14).toMatchObject({ release_precedente: "1.2", ecart_precedente_pts: null });
    expect(Date.parse(v14.premiere_session)).toBeLessThan(Date.now());
  });

  it("la référence « Releases déclarantes » porte sur toutes les releases, même tronquées à l'affichage", async () => {
    const r = await disponible(filtres(), 1);
    expect(r.lignes).toHaveLength(1);
    expect(r.tronque).toBe(true);
    expect(r.releases).toBe(3);
    expect(r.declarantes.rate).toBeCloseTo(2 / 3, 10);
    expect(r.declarantes).toMatchObject({ sessions: 3, touchees: 1, exclues: 3, occurrences: 7, reason: null });
  });

  it("la release filtre la cohorte ; `release is null` rend la seule ligne Inconnue", async () => {
    const v14 = await disponible(filtres({ release: "1.4" }));
    expect(v14.lignes.map((l) => l.release)).toEqual(["1.4"]);
    const sans = await disponible(filtres({ seg: "v2:release:is_null" }));
    expect(sans.lignes.map((l) => l.release)).toEqual([null]);
  });

  it("la projection ajoutée à la cohorte ne change pas mobileSummary", async () => {
    const r = await lib.mobileSummary(filtres());
    expect(r.sessions.sessions).toBe(6);
    expect(r.js_errors?.occurrences).toBe(7);
    expect(r.js_errors?.sessions_affected).toBe(1);
  });

  it("deux apps, même « 1.4 » : deux lignes, l'état de collecte de chacune, la précédente dans la même app", async () => {
    const r = await disponible(filtresDeuxApps());
    expect(r.apps).toBe(2);
    // A : 1.4, 1.2, sans release ; B : 1.4, 1.3 — cinq groupes (app, release), pas quatre.
    expect(r.releases).toBe(5);
    const a14 = r.lignes.find((l) => l.app_id === APP && l.release === "1.4")!;
    const b14 = r.lignes.find((l) => l.app_id === APP_B && l.release === "1.4")!;
    // A garde SES 3 sessions et SON état déclaré ; B n'hérite pas de la déclaration de A.
    expect(a14).toMatchObject({ sessions: 3, sessions_touchees: 1, etat_js_errors: "active", occurrences: 7 });
    expect(a14.part_touchee).toBeCloseTo(1 / 3, 10);
    expect(b14).toMatchObject({
      sessions: 2,
      sessions_touchees: 1,
      occurrences: 2,
      etat_js_errors: "unknown",
      part_touchee: null,
      raison_part: lib.capacites.ERROR_FREE_REASONS.capability_unknown,
    });
    // La précédente de la 1.4 de A est la 1.2 de A, pas la 1.3 de B (plus récente).
    expect(a14.release_precedente).toBe("1.2");
    expect(b14.release_precedente).toBe("1.3");
    // Le taux des déclarantes ne compte QUE les sessions de A 1.4 : 1 touchée sur 3.
    // Groupées par release seule, les 5 sessions « 1.4 » seraient entrées au
    // dénominateur (2 touchées sur 5 : 60 % sans erreur au lieu de 66,7 %).
    expect(r.declarantes).toMatchObject({ sessions: 3, touchees: 1, occurrences: 7 });
    expect(r.declarantes.rate).toBeCloseTo(2 / 3, 10);
  });

  it("une seule app lue : apps = 1, la ligne n'a pas à nommer son app", async () => {
    expect((await disponible(filtres())).apps).toBe(1);
  });

  it("schéma sans release de session, ou sans runtime : disponible false, avec la raison", async () => {
    const etat = await lib.mobileSchema();
    const sansRelease = { ...etat, dimensions: new Set([...etat.dimensions].filter((k) => k !== "rum_session.release")) };
    expect(await lib.mobileParRelease(filtres(), 12, sansRelease)).toEqual({
      disponible: false,
      raison: lib.RAISON_SANS_RELEASE_SESSION,
    });
    // Et le résumé, lui, se lit toujours : la projection vaut NULL sans la colonne.
    expect((await lib.mobileSummary(filtres(), sansRelease)).sessions.sessions).toBe(6);
    const sansRuntime = { ...etat, runtime: false };
    expect(await lib.mobileParRelease(filtres(), 12, sansRuntime)).toEqual({
      disponible: false,
      raison: lib.capacites.RAISON_SANS_RUNTIME,
    });
  });

  it("sans error_source (v69) : parts null avec leur raison, jamais 100 %", async () => {
    const etat = await lib.mobileSchema();
    const r = await lib.mobileParRelease(filtres(), 12, { ...etat, errorSource: false });
    if (!r.disponible) throw new Error("indisponible");
    const v14 = r.lignes.find((l) => l.release === "1.4")!;
    expect(v14).toMatchObject({
      sessions: 3,
      sessions_touchees: null,
      occurrences: null,
      part_touchee: null,
      raison_part: lib.capacites.RAISON_SANS_SOURCE_JS,
    });
    expect(r.declarantes).toMatchObject({ rate: null, reason: "source_indisponible", occurrences: null });
  });
});
