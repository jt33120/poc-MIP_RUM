// P7.5 — la migration v82, le modèle de capacités et les lectures `/mobile`,
// prouvés sur PostgreSQL réel.
//
// CE QUE LE TEST UNITAIRE NE PROUVE PAS. Il verrouille la FORME des règles :
// trois états, un taux qui refuse de mentir, un vocabulaire fermé. Il ne prouve
// ni que `nulls not distinct` empêche une déclaration sans release de s'empiler
// à chaque lot, ni qu'une ingestion ne peut pas écrire `verified_at`, ni qu'un
// effacement d'app emporte la table, ni qu'une session d'un autre tenant ne
// prête pas ses erreurs à la cohorte. Seul PostgreSQL dit cela.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FiltersLike } from "../../apps/console/lib/filters";
import { parseAnalyticsQuery, type AnalyticsQuery } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

const A = "p75-app-a";
const B = "p75-app-b";
const APPS = [A, B];
const MIN = 60_000;

function fichiersSql(): string[] {
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  return [join(SQL_DIR, "schema.sql"), ...migrations.map((f) => join(SQL_DIR, f))];
}

/**
 * Modules console branchés sur la base jetable. `db.ts` lit DATABASE_URL à
 * l'évaluation et mémorise son pool sur globalThis : viser une autre base exige
 * d'oublier ce pool ET le registre de modules.
 */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const mobile = await import("../../apps/console/lib/queries-mobile");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  schema.forgetDimensionSchema();
  return { ...mobile, pool };
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

/** Requête résolue du contrat P6, sur l'app A et 24 h, plus les dimensions données. */
function requete(dimensions: Record<string, string> = {}): AnalyticsQuery {
  const sp = new URLSearchParams({ app: A, period: "24h", ...dimensions });
  const parsed = parseAnalyticsQuery(sp, { principal: { role: "admin", apps: null }, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

async function nettoyer(c: pg.Client) {
  for (const table of [
    "mobile_capabilities", "rum_event_index", "rum_event", "rum_error",
    "rum_span", "rum_pageview", "rum_session",
  ]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

/**
 * Jeu de recette.
 *
 * L'app B existe pour une seule raison : son émetteur cite, sur des lignes
 * MARQUÉES A, l'identifiant d'une session qui appartient à B. `rum_session`
 * ayant une clef primaire globale, c'est la forme que prend réellement la
 * tentative — et sans clef d'app dans la jointure, ces lignes viendraient
 * grossir la cohorte de A avec des sessions qui ne sont pas les siennes.
 */
async function semer(c: pg.Client) {
  for (const app of APPS) {
    await c.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
  const session = (
    app: string, id: string, runtime: string | null, os: string | null,
    release: string | null, visitor: string | null, bot: boolean, ageMin: number,
  ) =>
    c.query(
      `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id, is_bot,
                                started_at, last_seen_at)
       values ($1,$2,'mobile',$3,$4,$5,$6,$7, now() - ($8::int * interval '1 minute'),
               now() - ($8::int * interval '1 minute') + interval '2 minutes')`,
      [id, app, os, runtime, release, visitor, bot, ageMin],
    );

  // Cohorte de A : 4 sessions React Native récentes (une sans visiteur), 1 robot,
  // 1 web, 1 React Native HORS fenêtre.
  await session(A, "p75-rn-1", "react_native", "iOS", "4.2.0", "v-1", false, 10);
  await session(A, "p75-rn-2", "react_native", "iOS", "4.2.0", "v-2", false, 20);
  await session(A, "p75-rn-3", "react_native", "Android", "4.1.0", "v-3", false, 30);
  await session(A, "p75-rn-4", "react_native", "Android", "4.2.0", null, false, 40);
  await session(A, "p75-rn-bot", "react_native", "iOS", "4.2.0", "v-b", true, 15);
  await session(A, "p75-web-1", "browser", "Windows", "4.2.0", "v-w", false, 12);
  await session(A, "p75-rn-vieux", "react_native", "iOS", "4.2.0", "v-4", false, 3 * 1440);
  // Session de l'AUTRE tenant, que les lignes marquées A citeront plus bas.
  await session(B, "p75-b-rn-1", "react_native", "iOS", "9.9.9", "v-x", false, 10);

  const erreur = (app: string, span: string, sessionId: string, kind: string, source: string, occ: number, ageMin: number, fatal: boolean | null) =>
    c.query(
      `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, is_fatal, ts)
       values ($1,$2,$3,'incident',$4,$5,$6,$7, now() - ($8::int * interval '1 minute'))`,
      [span, sessionId, app, kind, occ, source, fatal, ageMin],
    );
  // 3 occurrences sur rn-1, 1 sur rn-2 : deux sessions touchées sur quatre.
  await erreur(A, "p75-e1", "p75-rn-1", "crash", "react_native_js", 3, 9, true);
  await erreur(A, "p75-e2", "p75-rn-2", "unhandledrejection", "react_native_js", 1, 19, false);
  // Bruit à ne PAS compter : le robot, le web, et une ligne MARQUÉE A qui cite
  // la session d'un autre tenant — la jointure app-scopée la laisse dehors.
  await erreur(A, "p75-e3", "p75-rn-bot", "crash", "react_native_js", 50, 14, true);
  await erreur(A, "p75-e4", "p75-web-1", "crash", "browser_js", 40, 11, false);
  await erreur(A, "p75-e5", "p75-b-rn-1", "crash", "react_native_js", 99, 9, true);

  const timing = (app: string, span: string, sessionId: string, nom: string, ms: number, ageMin: number) =>
    c.query(
      `insert into rum_event (span_id, session_id, app_id, name, event_type, timing_ms, ts)
       values ($1,$2,$3,$4,'timing',$5, now() - ($6::int * interval '1 minute'))`,
      [span, sessionId, app, nom, ms, ageMin],
    );
  await timing(A, "p75-t1", "p75-rn-1", "js_start_to_first_screen_ms", 700, 10);
  await timing(A, "p75-t2", "p75-rn-2", "js_start_to_first_screen_ms", 900, 20);
  await timing(A, "p75-t3", "p75-rn-3", "js_warm_start_to_first_screen_ms", 120, 30);
  // Émetteur backend P7.4 : `rum_event` peut porter un `session_id` NULL. Il ne
  // doit ni entrer dans la cohorte, ni faire échouer la lecture.
  await c.query(
    `insert into rum_event (span_id, session_id, app_id, name, event_type, timing_ms, ts)
     values ('p75-t4', null, $1, 'js_start_to_first_screen_ms', 'timing', 99999, now())`,
    [A],
  );

  await c.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values
       ('p75-p1','p75-rn-1',$1,'/accueil', now() - interval '10 minutes'),
       ('p75-p2','p75-rn-2',$1,'/accueil', now() - interval '20 minutes'),
       ('p75-p3','p75-rn-3',$1,'/panier',  now() - interval '30 minutes'),
       ('p75-p4','p75-web-1',$1,'/accueil', now() - interval '12 minutes')`,
    [A],
  );

  await c.query(
    `insert into rum_span (span_id, trace_id, tier, session_id, app_id, url, method, status_code, duration_ms, ts) values
       ('p75-s1', repeat('1',32), 'front','p75-rn-1',$1,'https://api.exemple.fr/panier','GET',200, 800, now() - interval '10 minutes'),
       ('p75-s2', repeat('2',32), 'front','p75-rn-2',$1,'https://api.exemple.fr/panier','GET',500, 1200, now() - interval '20 minutes'),
       ('p75-s3', repeat('3',32), 'front','p75-rn-3',$1,'https://api.exemple.fr/profil','GET',200, 50, now() - interval '30 minutes'),
       ('p75-s4', repeat('4',32), 'front','p75-web-1',$1,'https://api.exemple.fr/web','GET',200, 5000, now() - interval '12 minutes')`,
    [A],
  );
}

const capacite = (c: pg.Client, app: string, release: string | null, nom: string, declared: boolean) =>
  c.query(
    `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
     values ($1,'react_native',$2,$3,$4)
     on conflict (app_id, runtime, release, capability)
     do update set declared = excluded.declared, last_declared_at = now()`,
    [app, release, nom, declared],
  );

suite("P7.5 — v82, capacités et lectures /mobile sur PostgreSQL", () => {
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

  // ══════════════════ 1. Le modèle de capacités en base ══════════════════════

  it("une déclaration SANS release ne s'empile pas à chaque lot", async () => {
    // `nulls not distinct` (PostgreSQL 15) : sans lui, chaque lot d'une
    // application qui ne déclare pas sa version ajouterait six lignes de plus,
    // indéfiniment — et l'écran afficherait « Inconnu » noyé dans du bruit.
    await capacite(c, A, null, "js_errors", true);
    await capacite(c, A, null, "js_errors", false);
    await capacite(c, A, null, "js_errors", true);
    const { rows } = await c.query(
      "select count(*)::int n, bool_and(declared) d from mobile_capabilities where app_id=$1 and release is null",
      [A],
    );
    expect(rows[0]).toMatchObject({ n: 1, d: true });
    await c.query("delete from mobile_capabilities where app_id=$1 and release is null", [A]);
  });

  it("AUCUNE ingestion ne peut écrire verified_at, même en redéclarant", async () => {
    // C'est LA garantie du lot : une capacité activée n'est pas un test natif
    // passé. Elle tient à une chose — `verified_at` absent du `do update set`.
    await capacite(c, A, "4.2.0", "js_errors", true);
    await c.query(
      `update mobile_capabilities set verified_at = timestamptz '2026-09-18 08:00:00+00', verified_by = 'recette-ops'
        where app_id=$1 and release='4.2.0' and capability='js_errors'`,
      [A],
    );
    const { writeRows } = await import("../../apps/ingest/lib/pg-ingest.mjs");
    const pool = new pg.Pool({ connectionString: url });
    await writeRows(pool, {
      sessions: [], pageviews: [], metrics: [], errors: [], resources: [], longtasks: [],
      breadcrumbs: [], events: [], spans: [], eventIndex: [],
      capabilities: [
        { app_id: A, runtime: "react_native", release: "4.2.0", capability: "js_errors", declared: false },
      ],
    });
    await pool.end();
    const { rows } = await c.query(
      "select declared, verified_at, verified_by from mobile_capabilities where app_id=$1 and release='4.2.0' and capability='js_errors'",
      [A],
    );
    // L'état DÉCLARÉ suit le client ; la VÉRIFICATION ne bouge pas d'un iota.
    expect(rows[0].declared).toBe(false);
    expect(rows[0].verified_at?.toISOString()).toBe("2026-09-18T08:00:00.000Z");
    expect(rows[0].verified_by).toBe("recette-ops");
    await c.query("delete from mobile_capabilities where app_id=$1", [A]);
  });

  // ══════════════════ 2. La cohorte, et ce qu'elle exclut ════════════════════

  it("compte les sessions React Native de la fenêtre, et RIEN d'autre", async () => {
    const r = await lib.mobileSummary(filtres());
    // 4 sessions RN récentes. Exclus : le robot, la session web, la session RN
    // hors fenêtre, et l'homonyme de l'autre tenant.
    expect(r.sessions.sessions).toBe(4);
    // 3 visiteurs distincts, la quatrième session n'en portant pas : « inconnu »
    // pour elle, et surtout jamais additionné aux sessions.
    expect(r.sessions.visitors).toBe(3);
    expect(r.sessions.sessions_without_visitor).toBe(1);
    expect(r.unavailable).toEqual([]);
  });

  it("n'emprunte jamais les erreurs d'un autre tenant portant le même identifiant de session", async () => {
    const r = await lib.mobileSummary(filtres());
    // 3 + 1 = 4 occurrences. Les 50 du robot, les 40 du web et les 99 de B sont dehors.
    expect(r.js_errors?.occurrences).toBe(4);
    expect(r.js_errors?.crashes).toBe(3);
    expect(r.js_errors?.unhandled_rejections).toBe(1);
    expect(r.js_errors?.fatal).toBe(3);
    expect(r.js_errors?.sessions_affected).toBe(2);
  });

  it("le filtre de plateforme porte sur la cohorte ENTIÈRE, numérateur compris", async () => {
    // `platform=ios` devient la condition `os = 'iOS'` du contrat. Elle filtre la
    // cohorte, donc le dénominateur du taux — et non les seules occurrences, qui
    // donneraient les erreurs iOS rapportées à tout le parc.
    const ios = await lib.mobileSummary(filtres({ query: requete({ os: "iOS" }) }));
    expect(ios.sessions.sessions).toBe(2);
    expect(ios.js_errors?.occurrences).toBe(4); // rn-1 (3) et rn-2 (1) sont iOS
    const android = await lib.mobileSummary(filtres({ query: requete({ os: "Android" }) }));
    expect(android.sessions.sessions).toBe(2);
    expect(android.js_errors?.occurrences).toBe(0);
  });

  it("la release filtre la cohorte, parce qu'un binaire mobile ne change pas en cours de session", async () => {
    const v42 = await lib.mobileSummary(filtres({ query: requete({ release: "4.2.0" }) }));
    expect(v42.sessions.sessions).toBe(3);
    const v41 = await lib.mobileSummary(filtres({ query: requete({ release: "4.1.0" }) }));
    expect(v41.sessions.sessions).toBe(1);
    expect(v41.js_errors?.occurrences).toBe(0);
  });

  // ═══════════════ 3. Le taux qui refuse de mentir en base ═══════════════════

  it("sans déclaration de capacité, le taux vaut null — jamais 100 %", async () => {
    const r = await lib.mobileSummary(filtres());
    expect(r.js_error_free_session_rate).toBeNull();
    expect(r.js_error_free_unavailable_reason).toBe("capability_unknown");
    expect(r.capabilities.find((x) => x.capability === "js_errors")?.state).toBe("unknown");
    // Et les trois capacités natives sont « inconnues », pas « zéro ».
    for (const nom of ["native_crashes", "anr", "native_start"]) {
      expect(r.capabilities.find((x) => x.capability === nom)?.state).toBe("unknown");
    }
  });

  it("capacité déclarée INDISPONIBLE : toujours null, et pour une autre raison", async () => {
    await capacite(c, A, "4.2.0", "js_errors", false);
    await capacite(c, A, "4.1.0", "js_errors", false);
    const r = await lib.mobileSummary(filtres());
    expect(r.capabilities.find((x) => x.capability === "js_errors")?.state).toBe("unavailable");
    expect(r.js_error_free_session_rate).toBeNull();
    expect(r.js_error_free_unavailable_reason).toBe("capability_unavailable");
  });

  it("capacité déclarée ACTIVE : le taux se calcule, sur la même cohorte", async () => {
    await capacite(c, A, "4.2.0", "js_errors", true);
    const r = await lib.mobileSummary(filtres());
    expect(r.capabilities.find((x) => x.capability === "js_errors")?.state).toBe("active");
    // 2 sessions touchées sur 4 observées.
    expect(r.js_error_free_session_rate).toBeCloseTo(0.5, 10);
    expect(r.js_error_free_unavailable_reason).toBeNull();
  });

  it("les crashes natifs restent « Non collecté » même quand le SDK les déclare indisponibles", async () => {
    await capacite(c, A, "4.2.0", "native_crashes", false);
    await capacite(c, A, "4.2.0", "anr", false);
    const r = await lib.mobileSummary(filtres());
    expect(r.capabilities.find((x) => x.capability === "native_crashes")?.state).toBe("unavailable");
    expect(r.capabilities.find((x) => x.capability === "anr")?.state).toBe("unavailable");
    // Et surtout : AUCUN champ de la réponse ne porte un compte de crashes natifs.
    expect(Object.keys(r)).not.toContain("native_crashes");
    expect(JSON.stringify(r)).not.toContain("crash_free");
  });

  // ═══════════════════ 4. Démarrage, écrans et requêtes ══════════════════════

  it("sépare démarrage à froid et à chaud, et ignore l'événement sans session", async () => {
    const r = await lib.mobileSummary(filtres());
    expect(r.startup.cold).toMatchObject({ samples: 2, p50_ms: 800 });
    expect(r.startup.warm).toMatchObject({ samples: 1, p50_ms: 120 });
    // L'événement backend (session_id NULL, 99 999 ms) n'entre dans aucune des deux.
    expect(r.startup.cold?.p95_ms).toBeLessThan(1000);
  });

  it("classe les écrans de la cohorte, sans ceux de la session web", async () => {
    const r = await lib.mobileSummary(filtres());
    expect(r.screens).toEqual([
      { route: "/accueil", views: 2, sessions: 2 },
      { route: "/panier", views: 1, sessions: 1 },
    ]);
  });

  it("classe les requêtes par latence, origine retirée, sans celles de la session web", async () => {
    const r = await lib.mobileSummary(filtres());
    expect(r.resources.map((x) => x.path)).toEqual(["/panier", "/profil"]);
    expect(r.resources[0]).toMatchObject({ method: "GET", calls: 2, errors: 1 });
    expect(r.resources[0].p75_ms).toBeGreaterThan(1000);
  });

  // ═══════════ 5. Périmètre : `apps: []` n'est pas « toutes les apps » ═══════

  it("un périmètre vide rend zéro, jamais tout", async () => {
    const vide = await lib.mobileSummary(
      filtres({ query: { version: 1, scope: { requestedApp: A, authorizedApps: [], effectiveApps: [] }, range: { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date().toISOString(), preset: "24h", bucketSeconds: 3600 }, filters: { includeBots: false, includeInternal: false, segments: [] } } }),
    );
    expect(vide.sessions.sessions).toBe(0);
    expect(vide.js_errors?.occurrences).toBe(0);
    expect(vide.screens).toEqual([]);
    expect(vide.declarations).toEqual([]);
  });

  // ═════════════════ 6. Rétention, effacement et DSAR ════════════════════════

  it("erase_app_data emporte les capacités de l'app, et seulement les siennes", async () => {
    await capacite(c, B, "9.9.9", "js_errors", true);
    const { rows } = await c.query("select erase_app_data($1) as r", [A]);
    expect(Number(rows[0].r.mobile_capabilities)).toBeGreaterThan(0);
    const restantes = await c.query(
      "select app_id, count(*)::int n from mobile_capabilities where app_id = any($1::text[]) group by app_id",
      [APPS],
    );
    expect(restantes.rows).toEqual([{ app_id: B, n: 1 }]);
    await c.query("delete from mobile_capabilities where app_id=$1", [B]);
  });

  it("purge_rum_app retire une déclaration qu'aucun lot ne rafraîchit plus", async () => {
    await capacite(c, A, "3.0.0", "js_errors", true);
    // Les deux dates reculent ensemble : la contrainte refuse une première
    // déclaration POSTÉRIEURE à la dernière, et elle a raison — ce serait une
    // ligne qu'aucun lot n'aurait pu écrire.
    await c.query(
      `update mobile_capabilities
          set first_declared_at = now() - interval '120 days', last_declared_at = now() - interval '90 days'
        where app_id=$1 and release='3.0.0'`,
      [A],
    );
    await capacite(c, A, "4.2.0", "js_errors", true);
    const { rows } = await c.query("select purge_rum_app($1, now() - interval '30 days') as r", [A]);
    expect(Number(rows[0].r.mobile_capabilities)).toBe(1);
    const restantes = await c.query("select release from mobile_capabilities where app_id=$1", [A]);
    expect(restantes.rows.map((r) => r.release)).toEqual(["4.2.0"]);
  });

  it("la table est HORS périmètre DSAR, et c'est structurel : elle n'a pas de session", async () => {
    // L'ajouter à DSAR_CHILD_TABLES ferait échouer l'effacement d'une personne :
    // la requête cherche `session_id in (…)`, colonne qui n'existe pas ici.
    const { rows } = await c.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='mobile_capabilities'`,
    );
    const colonnes = rows.map((r) => r.column_name);
    expect(colonnes).not.toContain("session_id");
    expect(colonnes).not.toContain("visitor_id");
    expect(colonnes).not.toContain("user_id_hash");
    const { DSAR_CHILD_TABLES } = await import("../../apps/console/lib/dsar");
    expect(DSAR_CHILD_TABLES as readonly string[]).not.toContain("mobile_capabilities");
  });

  it("v79 réparée : erase_app_data emporte à nouveau les analyses enregistrées et les tableaux de bord", async () => {
    // v80 avait repris la définition depuis v72 au lieu de v79 : les deux lignes
    // ajoutées par v79 avaient disparu sans que rien ne le signale.
    const def = await c.query(
      "select prosrc from pg_proc where proname = 'erase_app_data'",
    );
    expect(def.rows[0].prosrc).toContain("analytics_saved_view");
    expect(def.rows[0].prosrc).toContain("delete from dashboard");
  });

  // ═════════════════ 7. Schéma antérieur : partiel, jamais zéro ══════════════

  it("sans la colonne runtime, la réponse est PARTIELLE et le dit", async () => {
    // Fenêtre de déploiement : la console est publiée avant la migration. Rendre
    // « 0 session React Native » y serait faux — il n'y a pas zéro session, il n'y
    // a aucune cohorte identifiable.
    const etat = { runtime: false, capabilities: false, errorSource: true, dimensions: new Set<string>() };
    const r = await lib.mobileSummary(filtres(), etat);
    expect(r.unavailable[0]).toContain("v82");
    expect(r.sessions.visitors).toBeNull();
    expect(r.js_errors).toBeNull();
    expect(r.js_error_free_session_rate).toBeNull();
    expect(r.capabilities.every((x) => x.state === "unknown")).toBe(true);
  });
});
