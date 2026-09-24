// B8 — `runtime`, `browser_version`, `os_version` et `net_type`, dimensions de
// LECTURE du contrat, prouvées sur un vrai PostgreSQL (aucune migration : les
// colonnes existent depuis v82, v75 et v53).
//
// CE QUE LE TEST PROUVE. Que `seg=v2:runtime:eq:react_native` isole la cohorte
// React Native dans les lectures d'écran réelles (liste et tuiles de /sessions,
// Explorer) ; que « Inconnu » (`is_null`) et « différent de » (`neq`, qui écarte
// l'inconnu) comptent ce qu'ils annoncent ; que le regroupement par runtime range
// l'inconnu à part ; et que le PÉRIMÈTRE tient : un viewer restreint ne lit que ses
// apps, une app hors périmètre est refusée avant tout SQL, `apps = []` ne rend
// aucune ligne.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExplorerPlan } from "../../apps/console/lib/analytics-schema";
import type { Filters } from "../../apps/console/lib/filters";
import {
  intersectApp,
  parseAnalyticsQuery,
  type AnalyticsQuery,
  type ScopePrincipal,
} from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP_B8_A = "b8-dims-a";
const APP_B8_B = "b8-dims-b";
const APPS_B8 = [APP_B8_A, APP_B8_B];
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

// Une heure pleine, terminée : jamais dans le futur, jamais au bord du retard d'ingestion.
const TO = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
const FROM = new Date(TO.getTime() - 3_600_000);
const DEDANS = new Date(FROM.getTime() + 60_000);

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

/** Modules console branchés sur la base jetable (voir query-contract-sql.test.ts). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const queries = await import("../../apps/console/lib/queries");
  const sessions = await import("../../apps/console/lib/queries-sessions");
  const explorer = await import("../../apps/console/lib/queries-explorer");
  const schema = await import("../../apps/console/lib/query-schema");
  const filters = await import("../../apps/console/lib/filters");
  const analytics = await import("../../apps/console/lib/analytics-schema");
  const { pool } = await import("../../apps/console/lib/db");
  schema.forgetDimensionSchema();
  return { ...queries, ...sessions, ...explorer, ...schema, ...filters, analytics, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

interface SessionB8 {
  id: string;
  app: string;
  runtime: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  netType: string | null;
  bot?: boolean;
}

/**
 * App A : deux sessions React Native (iOS 17, Android 14), deux navigateurs
 * (Chrome 139 en 4g, Firefox 128 sans type de réseau), une session d'émetteur
 * inconnu (runtime NULL) et un robot React Native. App B : une session React Native.
 */
const SESSIONS_B8: SessionB8[] = [
  { id: "b8-a-rn-ios", app: APP_B8_A, runtime: "react_native", browser: null, browserVersion: null, os: "iOS", osVersion: "17", netType: null },
  { id: "b8-a-rn-android", app: APP_B8_A, runtime: "react_native", browser: null, browserVersion: null, os: "Android", osVersion: "14", netType: null },
  { id: "b8-a-web-chrome", app: APP_B8_A, runtime: "browser", browser: "Chrome", browserVersion: "139", os: "Windows", osVersion: "10", netType: "4g" },
  { id: "b8-a-web-firefox", app: APP_B8_A, runtime: "browser", browser: "Firefox", browserVersion: "128", os: "Linux", osVersion: null, netType: null },
  { id: "b8-a-inconnu", app: APP_B8_A, runtime: null, browser: null, browserVersion: null, os: null, osVersion: null, netType: null },
  { id: "b8-a-rn-robot", app: APP_B8_A, runtime: "react_native", browser: null, browserVersion: null, os: "iOS", osVersion: "17", netType: null, bot: true },
  { id: "b8-b-rn", app: APP_B8_B, runtime: "react_native", browser: null, browserVersion: null, os: "iOS", osVersion: "18", netType: null },
];

/** Occurrences d'erreurs par session : une SOMME d'occurrences, jamais un compte de lignes. */
const ERREURS_B8: [string, string, number, string][] = [
  ["b8-a-rn-ios", APP_B8_A, 2, "react_native_js"],
  ["b8-a-rn-ios", APP_B8_A, 1, "react_native_js"],
  ["b8-a-web-chrome", APP_B8_A, 5, "browser_js"],
  ["b8-a-rn-robot", APP_B8_A, 40, "react_native_js"],
  ["b8-b-rn", APP_B8_B, 7, "react_native_js"],
];

async function nettoyerB8(c: pg.Client): Promise<void> {
  for (const table of ["rum_error", "rum_pageview", "rum_session", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS_B8]);
  }
}

async function semerB8(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active, internal) values ($1, 'B8 A', true, false), ($2, 'B8 B', true, false)
     on conflict (app_id) do update set active = true, internal = false`,
    [APP_B8_A, APP_B8_B],
  );
  for (const [i, s] of SESSIONS_B8.entries()) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, runtime, browser, browser_version, os, os_version,
                                net_type, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ($1, $2, 'mobile', $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $10::timestamptz + interval '2 minutes', 1, 1)`,
      [s.id, s.app, s.bot === true, s.runtime, s.browser, s.browserVersion, s.os, s.osVersion, s.netType, DEDANS],
    );
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, '/accueil', $4)`,
      // Identifiant de span hexadécimal propre à ce fichier (span_id est unique).
      [`b8d1${i.toString(16).padStart(12, "0")}`, s.id, s.app, DEDANS],
    );
  }
  for (const [session, app, occurrences, source] of ERREURS_B8) {
    await c.query(
      `insert into rum_error (app_id, session_id, fingerprint, error_type, message, kind, route, occurrences, error_source, ts)
       values ($1, $2, 'b8fp', 'TypeError', 'boom', 'error', '/accueil', $3, $4, $5)`,
      [app, session, occurrences, source, DEDANS],
    );
  }
}

suite("B8 — dimensions de lecture runtime, versions et type de réseau", () => {
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
  const filtres = (query: AnalyticsQuery): Filters => lib.filtersOfQuery(query);

  const planB8 = (measure: ExplorerPlan["measure"], extra: Partial<ExplorerPlan> = {}): ExplorerPlan => ({
    version: lib.analytics.EXPLORER_VERSION,
    dataset: "sessions",
    measure,
    variant: null,
    groupBy: [],
    visualization: "value",
    limit: 10,
    cursor: null,
    ...extra,
  });

  /** Les lectures d'écran qui comptent des sessions, ramenées au nombre de sessions lues. */
  const SESSIONS_LUES: { lecture: string; lire: (q: AnalyticsQuery) => Promise<number> }[] = [
    { lecture: "/sessions — liste", lire: async (q) => (await lib.listSessions(filtres(q), { limit: 100, offset: 0 })).length },
    { lecture: "/sessions — sessions commencées", lire: async (q) => (await lib.engagementStats(filtres(q))).sessions_started },
    {
      lecture: "Explorer — sessions commencées",
      lire: async (q) => (await lib.exploreAnalytics({ query: q, plan: planB8({ field: "started", aggregation: "count" }) })).data.total ?? -1,
    },
  ];

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyerB8(c);
    await semerB8(c);
    lib = await consoleSur(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyerB8(c);
    await c.end();
  });

  it("la sonde de schéma voit les quatre colonnes : aucune migration n'est nécessaire", async () => {
    const schema = await lib.dimensionSchema();
    for (const colonne of ["runtime", "browser_version", "os_version", "net_type"]) {
      expect(schema.has(`rum_session.${colonne}`), colonne).toBe(true);
    }
  });

  const CAS: { cas: string; seg: string; attendu: number }[] = [
    // Le robot React Native reste exclu par défaut ; l'émetteur inconnu n'est pas « React Native ».
    { cas: "cohorte React Native", seg: "runtime:eq:react_native", attendu: 2 },
    { cas: "navigateurs", seg: "runtime:eq:browser", attendu: 2 },
    { cas: "émetteur inconnu", seg: "runtime:is_null", attendu: 1 },
    // `neq` écarte aussi l'inconnu (SQL `<>`) : « Inconnu » se demande par `is_null`.
    { cas: "tout sauf les navigateurs", seg: "runtime:neq:browser", attendu: 2 },
    { cas: "Chrome 139", seg: "browser_version:eq:139", attendu: 1 },
    { cas: "iOS 17 (robot exclu)", seg: "os_version:eq:17", attendu: 1 },
    { cas: "réseau 4g estimé", seg: "net_type:eq:4g", attendu: 1 },
    { cas: "type de réseau inconnu", seg: "net_type:is_null", attendu: 4 },
    { cas: "React Native ET iOS 17", seg: "runtime:eq:react_native;os_version:eq:17", attendu: 1 },
  ];

  it.each(CAS)("$cas : chaque lecture compte $attendu session(s)", async ({ seg, attendu }) => {
    const q = requete(`app=${APP_B8_A}&seg=v2:${seg}`);
    for (const { lecture, lire } of SESSIONS_LUES) expect(await lire(q), lecture).toBe(attendu);
  });

  it("robots inclus : le robot React Native entre dans la cohorte", async () => {
    const q = requete(`app=${APP_B8_A}&bots=1&seg=v2:runtime:eq:react_native`);
    for (const { lecture, lire } of SESSIONS_LUES) expect(await lire(q), lecture).toBe(3);
  });

  it("Explorer : occurrences d'erreurs de la cohorte = somme des occurrences, sur la session jointe", async () => {
    const plan = planB8({ field: "occurrences", aggregation: "sum" }, { dataset: "errors" });
    const rn = await lib.exploreAnalytics({ query: requete(`app=${APP_B8_A}&seg=v2:runtime:eq:react_native`), plan });
    expect(rn.data.total).toBe(3);
    const web = await lib.exploreAnalytics({ query: requete(`app=${APP_B8_A}&seg=v2:runtime:eq:browser`), plan });
    expect(web.data.total).toBe(5);
  });

  it("Explorer : regroupement par runtime, l'inconnu dans son propre groupe (jamais « web »)", async () => {
    const plan = planB8({ field: "started", aggregation: "count" }, { groupBy: ["runtime"], visualization: "toplist" });
    const r = await lib.exploreAnalytics({ query: requete(`app=${APP_B8_A}`), plan });
    const groupes = Object.fromEntries(r.data.groups.map((g) => [String(g.key[0]), g.value]));
    expect(groupes).toEqual({ react_native: 2, browser: 2, null: 1 });
    expect(r.meta.group_by).toEqual(["runtime"]);
  });

  it("Explorer : série des sessions commencées de la cohorte, la somme des seaux égale le total", async () => {
    const plan = planB8({ field: "started", aggregation: "count" }, { visualization: "timeseries" });
    const r = await lib.exploreAnalytics({ query: requete(`app=${APP_B8_A}&seg=v2:runtime:eq:react_native`), plan });
    expect(r.data.total).toBe(2);
    expect(r.data.series.reduce((s, p) => s + (p.value ?? 0), 0)).toBe(2);
  });

  describe("périmètre", () => {
    const rn = "seg=v2:runtime:eq:react_native";

    it("viewer restreint à A, toutes ses apps : les sessions React Native de A seulement", async () => {
      const q = requete(rn, { role: "viewer", apps: [APP_B8_A] });
      expect(q.scope.effectiveApps).toEqual([APP_B8_A]);
      for (const { lecture, lire } of SESSIONS_LUES) expect(await lire(q), lecture).toBe(2);
    });

    it("viewer restreint à A et B : A et B, rien d'autre de la base", async () => {
      const q = requete(rn, { role: "viewer", apps: [APP_B8_A, APP_B8_B] });
      for (const { lecture, lire } of SESSIONS_LUES) expect(await lire(q), lecture).toBe(3);
    });

    it("app hors périmètre, ou `apps = []` : refus AVANT tout SQL", () => {
      expect(() => requete(`app=${APP_B8_B}&${rn}`, { role: "viewer", apps: [APP_B8_A] })).toThrow(/forbidden_app/);
      expect(() => requete(rn, { role: "viewer", apps: [] })).toThrow(/no_app_access/);
    });

    it("périmètre effectif vide (widget d'une autre app) : zéro, jamais les chiffres de l'autre app", async () => {
      const vide = intersectApp(requete(`app=${APP_B8_A}&${rn}`, { role: "viewer", apps: [APP_B8_A] }), APP_B8_B);
      expect(vide.scope.effectiveApps).toEqual([]);
      for (const { lecture, lire } of SESSIONS_LUES) expect(await lire(vide), lecture).toBe(0);
    });
  });
});
