// P6.1 — migration-v75 et dimensions aux bonnes frontières, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code. Que la migration se rejoue
// sans effet et que ses contraintes acceptent les bornes exactes de l'ingestion.
// Qu'un lot réel — navigateur, mobile, tablette, backend sans user-agent — écrit
// chaque dimension à sa frontière : la session pour le terminal, chaque signal
// pour env, release et service. Qu'une release qui change pendant une visite, puis
// une session modifiée après coup, ne changent pas le regroupement passé. Que les
// sélecteurs de valeurs ne sortent jamais de leur app ni de leur fenêtre. Que
// purge, effacements et export DSAR emportent ces colonnes. Enfin, sur une seconde
// base restée en v74, que le même code écrit pendant la fenêtre de déploiement,
// puis écrit les dimensions dès v75 appliquée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPayload, buildScreenSpan, type MobileConfig } from "../../packages/rum-mobile/src/core";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import { dimensionValuesRequest, type DimensionValuesInput } from "../../apps/console/lib/dimensions";
import type { DimensionValues } from "../../apps/console/lib/dimensions";
import type { IdentityDsarIo } from "../../apps/console/lib/queries-dsar";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../apps/ingest/lib/identity-hash.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeLogs, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp, flattenOtlpLogs } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const poolFenetre = new pg.Pool(urlFenetre ? { connectionString: urlFenetre, max: 4 } : { max: 4 });

const A = "p61-a";
const B = "p61-b";
const PLAFOND = "p61-plafond";
const BORNES = "p61-bornes";
const EFFACEMENT = "p61-effacement";
const FENETRE = "p61-fenetre";
const APPS = [A, B, PLAFOND, BORNES, EFFACEMENT];
const SECRET = "test-only-identity-secret";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const TABLETTE = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36";
const ROBOT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36";
const muet = { error() {} };

/** Tables écrites par ces lots, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "ingest_raw", "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask",
  "rum_breadcrumb", "rum_event", "rum_span", "rum_log", "rum_pageview", "rum_session",
];
/** Tables qui gagnent env et release (v75), rum_span et la projection gagnant aussi service. */
const TABLES_SIGNAL = ["rum_pageview", "rum_metric", "rum_action", "rum_resource", "rum_longtask", "rum_event", "rum_span", "rum_event_index"];

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;
type Signal = Omit<EmitSpan, "startTime" | "endTime">;

let compteur = 0;
/** Identifiant de span natif propre à ce fichier (span_id est unique sur chaque table). */
const nouveauSpan = () => (0x6100000000000000n + BigInt(++compteur)).toString(16);

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= maxVersion)
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    for (const table of TABLES_APP) await db.query(`delete from ${table} where app_id = $1`, [app]);
  }
}

async function enregistrer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    await db.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
}

/** Resource du SDK web (otel.ts). */
const web = (app: string, over: Attrs = {}): Attrs => ({
  "service.name": "mip-rum-web",
  "service.version": "0.4.0",
  "mip.app_id": app,
  "mip.user_agent": CHROME,
  "deployment.environment.name": "production",
  "mip.release": "2.3.1",
  ...over,
});

/** Émetteur OpenTelemetry backend : ni user-agent, ni session. */
const backend = (app: string): Attrs => ({
  "mip.app_id": app, "service.name": "checkout-api", "service.version": "7.1.0", "deployment.environment": "staging",
});

function signal(name: string, session: string, attributes: Attrs = {}): Signal {
  return {
    name,
    traceId: TRACE,
    spanId: nouveauSpan(),
    attributes: {
      "mip.session_id": session, "mip.route": "/panier", "mip.device_type": "desktop",
      "mip.visitor_id": `visiteur-${session}`, ...attributes,
    },
  };
}

const pageview = (session: string, extra: Attrs = {}) =>
  signal("pageview", session, { "mip.url": "https://app.exemple.fr/panier", "mip.nav_type": "navigate", ...extra });

/** Un signal de chaque famille écrite par writeRows. */
function visite(session: string, extra: Attrs = {}): Signal[] {
  const reseau = nouveauSpan();
  return [
    pageview(session, extra),
    signal("webvital.LCP", session, { "webvital.name": "LCP", "webvital.value": 1800, "webvital.id": `v5-${nouveauSpan()}`, ...extra }),
    signal("exception", session, { "exception.type": "TypeError", "exception.message": "boom", "mip.error_kind": "error", ...extra }),
    signal("resource", session, { "resource.url": "https://cdn.exemple.fr/app.js", "resource.type": "script", "resource.duration_ms": 420, ...extra }),
    signal("longtask", session, { "longtask.duration_ms": 90, ...extra }),
    signal("breadcrumb", session, { "breadcrumb.type": "click", "breadcrumb.label": "#payer", ...extra }),
    signal("track.paiement", session, { "mip.props": JSON.stringify({ montant: 42 }), ...extra }),
    signal("rum.action", session, {
      "mip.event_type": "action", "mip.event_name": "Payer", "mip.action_type": "click",
      "mip.action_id": nouveauSpan().padStart(32, "0"), ...extra,
    }),
    signal("http.client", session, {
      "mip.trace_id": TRACE, "mip.span_id": reseau, "http.url": "https://api.exemple.fr/paiements",
      "http.method": "POST", "http.status_code": 201, "http.duration_ms": 120, ...extra,
    }),
  ];
}

/** Encodage réel du SDK web, tous les spans à `ms`. */
function ressource(attrs: Attrs, spans: Signal[], ms = Date.now() - 1_000) {
  const t = msToHr(ms);
  return (buildResourceSpans(attrs, spans.map((span) => ({ ...span, startTime: t, endTime: t }))) as { resourceSpans: unknown[] })
    .resourceSpans[0];
}

/** Identités brutes remplacées par leur HMAC avant le parseur, comme aux deux ports. */
function aplatir(...resourceSpans: unknown[]) {
  return flattenOtlp(secureOtlpIdentities({ resourceSpans }, SECRET).payload);
}

const kv = (key: string, value: unknown) => ({
  key,
  value: typeof value === "number" ? { intValue: String(value) } : { stringValue: String(value) },
});
const attributs = (attrs: Attrs) => Object.entries(attrs).map(([key, value]) => kv(key, value));
const nanos = (ms: number) => `${ms}000000`;

/** Fenêtre [maintenant - 1 h, maintenant + 1 min), bornes ISO UTC. */
const fenetre = () => ({
  from: new Date(Date.now() - 3_600_000).toISOString(),
  to: new Date(Date.now() + 60_000).toISOString(),
});

const suite = url ? describe : describe.skip;
const suiteFenetre = urlFenetre ? describe : describe.skip;

suite("migration-v75 et dimensions — PostgreSQL", () => {
  let dimensionValues: typeof import("../../apps/console/lib/queries-dimensions").dimensionValues;
  let dsarIdentityExport: typeof import("../../apps/console/lib/queries-dsar").dsarIdentityExport;

  const lire = async <T,>(text: string, params: unknown[]) => (await pool.query(text, params)).rows as T[];
  const io: IdentityDsarIo = {
    query: lire as IdentityDsarIo["query"],
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const resultat = await fn(client);
        await client.query("commit");
        return resultat;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  };

  /** Sélecteur de l'app, fenêtre récente par défaut, admin transverse. */
  async function valeurs(dimension: string, app: string, over: Partial<DimensionValuesInput> = {}): Promise<DimensionValues> {
    const demande = dimensionValuesRequest({ dimension, app, authorizedApps: null, range: fenetre(), ...over });
    if (!demande.ok) throw new Error(demande.error);
    return dimensionValues(demande.request, lire);
  }

  beforeAll(async () => {
    // Rejouée DEUX FOIS avant toute écriture, comme un pre-deploy relancé.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await enregistrer(pool, APPS);
    await nettoyer(pool, APPS);
    _resetColonnesCache();
    // Les modules console lisent DATABASE_URL à leur import : la base jetable, jamais une autre.
    process.env.DATABASE_URL = url;
    ({ dimensionValues } = await import("../../apps/console/lib/queries-dimensions"));
    ({ dsarIdentityExport } = await import("../../apps/console/lib/queries-dsar"));
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool, APPS);
    await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
    await pool.end();
    const { pool: consolePool } = await import("../../apps/console/lib/db");
    await consolePool.end();
  });

  it("pose des colonnes nullables et neuf contraintes NOT VALID, une seule fois malgré le rejeu", async () => {
    const { rows } = await pool.query<{ colonne: string; is_nullable: string; data_type: string }>(
      `select table_name || '.' || column_name as colonne, is_nullable, data_type
         from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'rum_session' and column_name in ('browser', 'browser_version', 'os', 'os_version'))
            or (table_name = any($1::text[]) and column_name in ('env', 'release', 'service')))
        order by (table_name || '.' || column_name) collate "C"`,
      [TABLES_SIGNAL],
    );
    const attendues = [
      "rum_session.browser", "rum_session.browser_version", "rum_session.os", "rum_session.os_version",
      ...TABLES_SIGNAL.flatMap((t) => [`${t}.env`, `${t}.release`]),
      "rum_span.service", "rum_event_index.service",
    ].sort();
    expect(rows.map((r) => r.colonne)).toEqual(attendues);
    for (const r of rows) expect(r).toMatchObject({ is_nullable: "YES", data_type: "text" });

    const contraintes = (await pool.query<{ table: string; convalidated: boolean }>(
      `select conrelid::regclass::text as table, convalidated from pg_constraint
        where conname like '%\\_dimensions\\_v75' order by conrelid::regclass::text collate "C"`,
    )).rows;
    expect(contraintes).toEqual(["rum_session", ...TABLES_SIGNAL].sort().map((table) => ({ table, convalidated: false })));
  });

  it("les contraintes refusent ce que l'ingestion écarte et acceptent ses bornes exactes", async () => {
    await nettoyer(pool, [BORNES]);
    const session = (valeurs: Attrs) => {
      const colonnes = Object.keys(valeurs);
      return pool.query(
        `insert into rum_session (session_id, app_id, ${colonnes.join(", ")}) values ($1, $2, ${colonnes.map((_, i) => `$${i + 3}`).join(", ")})`,
        [`p61-bornes-${nouveauSpan()}`, BORNES, ...Object.values(valeurs)],
      );
    };
    const vue = (valeurs: Attrs) => pool.query(
      "insert into rum_pageview (app_id, route, env, release) values ($1, '/', $2, $3)",
      [BORNES, valeurs.env ?? null, valeurs.release ?? null],
    );
    const span = (valeurs: Attrs) => pool.query(
      "insert into rum_span (span_id, trace_id, tier, app_id, duration_ms, service) values ($1, $2, 'back', $3, 1, $4)",
      [nouveauSpan(), TRACE, BORNES, valeurs.service ?? null],
    );
    const projection = (valeurs: Attrs) => pool.query(
      "insert into rum_event_index (app_id, ts, kind, source_span_id, release) values ($1, now(), 'pageview', $2, $3)",
      [BORNES, nouveauSpan(), valeurs.release ?? null],
    );
    const refus: Array<[(v: Attrs) => Promise<unknown>, Attrs, string]> = [
      [session, { browser: "b".repeat(81) }, "rum_session_dimensions_v75"],
      [session, { os: "" }, "rum_session_dimensions_v75"],
      [session, { browser_version: "9".repeat(121) }, "rum_session_dimensions_v75"],
      [vue, { release: "r".repeat(121) }, "rum_pageview_dimensions_v75"],
      [vue, { env: "" }, "rum_pageview_dimensions_v75"],
      [span, { service: "s".repeat(121) }, "rum_span_dimensions_v75"],
      [projection, { release: "" }, "rum_event_index_dimensions_v75"],
    ];
    for (const [inserer, valeurs, contrainte] of refus) {
      await expect(inserer(valeurs), JSON.stringify(valeurs).slice(0, 60)).rejects.toMatchObject({ code: "23514", constraint: contrainte });
    }
    await session({ browser: "b".repeat(80), browser_version: "9".repeat(120), os: "o".repeat(80), os_version: "9".repeat(120) });
    await vue({ env: "e".repeat(120), release: "r".repeat(120) });
    await span({ service: "s".repeat(120) });
    await projection({ release: "r".repeat(120) });
    await nettoyer(pool, [BORNES]);
  });

  it("un lot réel écrit chaque dimension à sa frontière, immédiat comme différé, et se rejoue", async () => {
    await nettoyer(pool, [A]);
    const lot = aplatir(ressource(web(A), visite("p61-lot")));
    await writeRows(pool, lot);
    await writeRows(pool, lot);

    expect((await pool.query("select browser, browser_version, os, os_version, device_type from rum_session where app_id = $1", [A])).rows)
      .toEqual([{ browser: "Chrome", browser_version: "139", os: "Windows", os_version: null, device_type: "desktop" }]);
    for (const table of TABLES_SIGNAL) {
      const { rows } = await pool.query(`select env, release from ${table} where app_id = $1`, [A]);
      expect(rows.length, table).toBeGreaterThan(0);
      for (const row of rows) expect(row, table).toEqual({ env: "production", release: "2.3.1" });
    }
    // Neuf spans : une ligne par table source, huit familles indexées, une action.
    expect((await pool.query("select kind, count(*)::int as n from rum_event_index where app_id = $1 group by kind order by kind", [A])).rows)
      .toEqual(["breadcrumb", "error", "event", "longtask", "pageview", "resource", "span", "vital"].map((kind) => ({ kind, n: kind === "event" ? 2 : 1 })));
    // Le nom constant d'un SDK MIP n'est pas un service ; rum_error garde sa release bornée.
    expect((await pool.query("select count(*)::int as n from rum_span where app_id = $1 and service is not null", [A])).rows[0].n).toBe(0);
    expect((await pool.query("select release, env, service from rum_error where app_id = $1", [A])).rows)
      .toEqual([{ release: "2.3.1", env: "production", service: null }]);

    // Différé : un lot du code P6.1, et un lot déposé avant P6.1 — sans aucun champ de dimension.
    await deposerLot(pool, A, aplatir(ressource(web(A, { "mip.release": "2.3.2" }), [pageview("p61-differe")])));
    const ancien = aplatir(ressource(web(A), [pageview("p61-ancien")]));
    for (const collection of [ancien.sessions, ancien.pageviews, ancien.eventIndex]) {
      for (const ligne of collection as Row[]) {
        for (const champ of ["env", "release", "browser", "browser_version", "os", "os_version"]) delete ligne[champ];
      }
    }
    await deposerLot(pool, A, ancien);
    expect(await drainerIngestRaw(pool, { log: muet })).toEqual({ drains: 2, echecs: 0 });
    expect((await pool.query(
      `select p.session_id, p.release, p.env, s.browser from rum_pageview p join rum_session s using (session_id)
        where p.app_id = $1 and p.session_id in ('p61-differe', 'p61-ancien') order by 1`,
      [A],
    )).rows).toEqual([
      { session_id: "p61-ancien", release: null, env: null, browser: null },
      { session_id: "p61-differe", release: "2.3.2", env: "production", browser: "Chrome" },
    ]);
  });

  it("mobile React Native et tablette : classe normalisée, plateforme portée par le système", async () => {
    await nettoyer(pool, [A]);
    const cfg: MobileConfig = {
      endpoint: "https://i/v1/traces", appId: A, apiKey: null, env: "prod", clientId: null,
      appVersion: "1.2.3", userAgent: "MIP-RN/0.1 (android 14)",
    };
    const mobile = buildPayload(cfg, [buildScreenSpan(
      { sessionId: "p61-rn", route: "Accueil", userHash: null, tz: "Europe/Paris", deviceType: "android" },
      Date.now() - 1_000, nouveauSpan(),
    )]) as { resourceSpans: unknown[] };
    await writeRows(pool, flattenOtlp(mobile));
    await writeRows(pool, aplatir(ressource(web(A, { "mip.user_agent": TABLETTE }), [pageview("p61-tablette")])));

    expect((await pool.query(
      `select session_id, device_type, browser, browser_version, os, os_version from rum_session where app_id = $1 order by 1`,
      [A],
    )).rows).toEqual([
      { session_id: "p61-rn", device_type: "mobile", browser: null, browser_version: null, os: "Android", os_version: "14" },
      { session_id: "p61-tablette", device_type: "tablet", browser: "Samsung Internet", browser_version: "28", os: "Android", os_version: "14" },
    ]);
    expect((await pool.query("select release, env from rum_pageview where app_id = $1 and session_id = 'p61-rn'", [A])).rows)
      .toEqual([{ release: "1.2.3", env: "prod" }]);
    expect((await valeurs("device", A)).values).toEqual([{ value: "mobile", count: 1 }, { value: "tablet", count: 1 }]);
  });

  it("erreur backend sans user-agent ni session : service, env et release déclarés, aucune session inventée", async () => {
    await nettoyer(pool, [A]);
    const maintenant = Date.now();
    await writeRows(pool, flattenOtlp({
      resourceSpans: [{
        resource: { attributes: attributs(backend(A)) },
        scopeSpans: [{ scope: { name: "opentelemetry.sdk" }, spans: [{
          traceId: TRACE, spanId: nouveauSpan(), kind: 2, name: "POST /paiements/{id}",
          startTimeUnixNano: nanos(maintenant - 2_000), endTimeUnixNano: nanos(maintenant - 1_990),
          attributes: attributs({ "http.request.method": "POST", "http.route": "/paiements/{id}" }),
          events: [{ name: "exception", timeUnixNano: nanos(maintenant - 1_995), attributes: attributs({ "exception.type": "ValueError", "exception.message": "montant négatif" }) }],
        }] }],
      }],
    }));
    const journal = flattenOtlpLogs({
      resourceLogs: [{
        resource: { attributes: attributs(backend(A)) },
        scopeLogs: [{ logRecords: [{
          timeUnixNano: nanos(maintenant - 1_000), severityNumber: 17, severityText: "ERROR", body: { stringValue: "échec" },
          attributes: attributs({ "exception.type": "KeyError", "exception.message": "devise" }),
        }] }],
      }],
    });
    await writeLogs(pool, journal.logs, journal.errors);

    expect((await pool.query("select count(*)::int as n from rum_session where app_id = $1", [A])).rows[0].n).toBe(0);
    expect((await pool.query("select tier, service, env, release from rum_span where app_id = $1", [A])).rows)
      .toEqual([{ tier: "back", service: "checkout-api", env: "staging", release: "7.1.0" }]);
    expect((await pool.query("select origin_signal, session_id, service, env, release from rum_error where app_id = $1 order by origin_signal", [A])).rows)
      .toEqual([
        { origin_signal: "log", session_id: null, service: "checkout-api", env: "staging", release: "7.1.0" },
        { origin_signal: "span_event", session_id: null, service: "checkout-api", env: "staging", release: "7.1.0" },
      ]);
    // Le sélecteur voit les deux exceptions dérivées, que la projection n'indexe pas, et le span.
    expect(await valeurs("service", A)).toMatchObject({ values: [{ value: "checkout-api", count: 3 }], unknown: 0, truncated: false });
  });

  it("une release qui change pendant la visite, puis une session modifiée après coup, ne réécrivent pas le passé", async () => {
    await nettoyer(pool, [A]);
    const session = "p61-deploiement";
    const t1 = Date.now() - 20 * 60_000;
    const t2 = Date.now() - 5 * 60_000;
    await writeRows(pool, aplatir(ressource(web(A, { "mip.release": "2.3.1" }), [pageview(session)], t1)));

    /** Vues par release DE L'ÉVÉNEMENT, sur la fenêtre qui précède le déploiement. */
    const avantDeploiement = async () => (await pool.query(
      `select p.release, count(*)::int as n from rum_pageview p
        where p.app_id = $1 and p.started_at < $2 group by 1 order by 1`,
      [A, new Date(t1 + 60_000)],
    )).rows;
    const projection = async () => (await pool.query(
      "select release, count(*)::int as n from rum_event_index where app_id = $1 and ts < $2 group by 1 order by 1",
      [A, new Date(t1 + 60_000)],
    )).rows;
    const reference = [{ release: "2.3.1", n: 1 }];
    expect(await avantDeploiement()).toEqual(reference);

    // Mise en production pendant la visite : la même session émet sous 2.4.0.
    await writeRows(pool, aplatir(ressource(web(A, { "mip.release": "2.4.0" }), [pageview(session)], t2)));
    expect((await pool.query("select release from rum_session where app_id = $1", [A])).rows).toEqual([{ release: "2.3.1" }]);
    expect(await avantDeploiement()).toEqual(reference);

    // La session change après coup (correction, enrichissement) : lue par la session,
    // l'ancienne vue changerait de groupe ; lue par l'événement, elle ne bouge pas.
    await pool.query("update rum_session set release = '9.9.9', browser = 'Firefox' where app_id = $1 and session_id = $2", [A, session]);
    expect((await pool.query(
      `select s.release, count(*)::int as n from rum_pageview p join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id
        where p.app_id = $1 and p.started_at < $2 group by 1`,
      [A, new Date(t1 + 60_000)],
    )).rows).toEqual([{ release: "9.9.9", n: 1 }]);
    expect(await avantDeploiement()).toEqual(reference);
    expect(await projection()).toEqual(reference);

    expect(await valeurs("release", A)).toMatchObject({
      values: [{ value: "2.3.1", count: 1 }, { value: "2.4.0", count: 1 }], unknown: 0, truncated: false,
    });
  });

  describe("sélecteurs de valeurs", () => {
    beforeAll(async () => {
      await nettoyer(pool, [A, B, PLAFOND]);
      await writeRows(pool, aplatir(
        ressource(web(A), visite("p61-sel-a")),
        ressource(web(B, { "mip.release": "b-confidentielle", "deployment.environment.name": "b-env" }), visite("p61-sel-b")),
        ressource(web(A, { "mip.release": "robot-1.0", "mip.user_agent": ROBOT }), [pageview("p61-sel-robot")]),
      ));
      // Lignes antérieures à v75 : aucune dimension, jamais comptées comme une valeur.
      await pool.query("insert into rum_session (session_id, app_id, last_seen_at) values ('p61-sel-historique', $1, now())", [A]);
      await pool.query(
        `insert into rum_event_index (app_id, session_id, ts, kind, source_span_id)
         values ($1, 'p61-sel-historique', now() - interval '1 minute', 'pageview', $2)`,
        [A, nouveauSpan()],
      );
    });

    it("A ne voit jamais les valeurs de B ; une app hors périmètre est refusée avant tout SQL", async () => {
      const releaseA = await valeurs("release", A);
      expect(releaseA.values.map((v) => v.value)).toEqual(["2.3.1"]);
      expect(JSON.stringify(await Promise.all(["env", "release", "browser"].map((d) => valeurs(d, A))))).not.toContain("b-");
      expect((await valeurs("release", B)).values).toEqual([{ value: "b-confidentielle", count: 9 }]);
      expect(dimensionValuesRequest({ dimension: "release", app: A, authorizedApps: [B], range: fenetre() }))
        .toEqual({ ok: false, error: "app_forbidden" });
      expect(dimensionValuesRequest({ dimension: "release", app: A, authorizedApps: [], range: fenetre() }))
        .toEqual({ ok: false, error: "app_forbidden" });
    });

    it("signaux : les robots sont exclus par défaut, l'historique sans dimension compte en inconnu", async () => {
      // Neuf signaux indexés sous 2.3.1 ; la vue du robot et la ligne historique à part.
      expect(await valeurs("release", A)).toMatchObject({
        population: "signaux", available: true, values: [{ value: "2.3.1", count: 9 }], unknown: 1,
      });
      expect((await valeurs("release", A, { includeBots: true })).values)
        .toEqual([{ value: "2.3.1", count: 9 }, { value: "robot-1.0", count: 1 }]);
      // Service : seuls spans et erreurs comptent, et aucun ne vient d'un SDK MIP.
      expect(await valeurs("service", A)).toMatchObject({ values: [], unknown: 2 });
      // Route : le template normalisé de la projection ; la ligne historique n'en a pas.
      expect(await valeurs("route", A)).toMatchObject({ available: true, values: [{ value: "/panier", count: 9 }], unknown: 1 });
    });

    it("sessions : navigateur, système, appareil et pays estimé de la fenêtre", async () => {
      expect(await valeurs("browser", A)).toMatchObject({ population: "sessions", values: [{ value: "Chrome", count: 1 }], unknown: 1 });
      expect(await valeurs("browser", A, { includeBots: true })).toMatchObject({ values: [{ value: "Chrome", count: 1 }], unknown: 2 });
      expect(await valeurs("os", A)).toMatchObject({ values: [{ value: "Windows", count: 1 }], unknown: 1 });
      expect(await valeurs("device", A)).toMatchObject({ values: [{ value: "desktop", count: 1 }], unknown: 1 });
      expect(await valeurs("country", A)).toMatchObject({ values: [], unknown: 2 });
    });

    it("fenêtre [from, to) : borne basse incluse, borne haute exclue, rien au-delà", async () => {
      const from = "2026-09-01T10:00:00.000001Z";
      const to = "2026-09-01T11:00:00Z";
      for (const [ts, release] of [
        ["2026-09-01T10:00:00.000001Z", "incluse"], ["2026-09-01T10:00:00Z", "avant"], ["2026-09-01T11:00:00Z", "exclue"],
      ]) {
        await pool.query(
          "insert into rum_event_index (app_id, ts, kind, source_span_id, release) values ($1, $2, 'pageview', $3, $4)",
          [PLAFOND, ts, nouveauSpan(), release],
        );
      }
      expect((await valeurs("release", PLAFOND, { range: { from, to } })).values).toEqual([{ value: "incluse", count: 1 }]);
      await nettoyer(pool, [PLAFOND]);
    });

    it("au plus 100 valeurs, les plus fréquentes d'abord, et la troncature annoncée", async () => {
      await pool.query(
        `insert into rum_event_index (app_id, ts, kind, source_span_id, release)
         select $1, now() - interval '1 minute', 'pageview', lpad(to_hex(x'62000000'::int + g), 16, '0'),
                case when g <= 3 then 'frequente' else 'r' || lpad(g::text, 3, '0') end
           from generate_series(1, 104) g`,
        [PLAFOND],
      );
      const resultat = await valeurs("release", PLAFOND);
      expect(resultat.values).toHaveLength(100);
      expect(resultat.values[0]).toEqual({ value: "frequente", count: 3 });
      expect(resultat.values.at(-1)).toEqual({ value: "r102", count: 1 });
      expect(resultat).toMatchObject({ truncated: true, unknown: 0 });
      await nettoyer(pool, [PLAFOND]);
    });
  });

  it("purge, effacements et export DSAR emportent les lignes et leurs dimensions", async () => {
    const session = "p61-effacement";
    const hash = hashIdentity(SECRET, EFFACEMENT, "user", "alice@example.test") as string;
    const ecrire = async () => {
      await nettoyer(pool, [EFFACEMENT]);
      await writeRows(pool, aplatir(ressource(web(EFFACEMENT), [pageview(session, { "mip.identity.user_id": "alice@example.test" })])));
    };
    const lignes = async () => Number((await pool.query(
      `select (select count(*) from rum_session where app_id = $1) + (select count(*) from rum_pageview where app_id = $1)
            + (select count(*) from rum_event_index where app_id = $1) as n`,
      [EFFACEMENT],
    )).rows[0].n);

    await ecrire();
    const exporte = await dsarIdentityExport(EFFACEMENT, "user", hash, new Date().toISOString(), io);
    expect(exporte.tables.rum_session).toEqual([expect.objectContaining({ browser: "Chrome", os: "Windows", device_type: "desktop" })]);
    expect(exporte.tables.rum_pageview).toEqual([expect.objectContaining({ env: "production", release: "2.3.1" })]);
    expect(exporte.tables.rum_event_index).toEqual([expect.objectContaining({ env: "production", release: "2.3.1" })]);

    await pool.query("select purge_rum_app($1, now() + interval '1 minute')", [EFFACEMENT]);
    expect(await lignes()).toBe(0);
    await ecrire();
    await pool.query("select erase_session($1)", [session]);
    expect(await lignes()).toBe(0);
    await ecrire();
    await pool.query("select erase_app_data($1)", [EFFACEMENT]);
    expect(await lignes()).toBe(0);
  });
});

suiteFenetre("fenêtre de déploiement : code P6.1 sur une base restée en v74", () => {
  const lireFenetre = async <T,>(text: string, params: unknown[]) => (await poolFenetre.query(text, params)).rows as T[];

  beforeAll(async () => {
    // Repartir d'un schéma vide : un passage précédent a pu y appliquer v75.
    await poolFenetre.query("drop schema public cascade; create schema public;");
    for (const file of migrations(74)) await poolFenetre.query(readFileSync(file, "utf8"));
    await enregistrer(poolFenetre, [FENETRE]);
    // Le cache de colonnes est par table, pas par base : il ne doit pas survivre à la base précédente.
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    await nettoyer(poolFenetre, [FENETRE]);
    await poolFenetre.query("delete from app_registry where app_id = $1", [FENETRE]);
    await poolFenetre.end();
  });

  it("le lot commit sans les colonnes v75, les sélecteurs se disent indisponibles, puis tout s'écrit dès la migration", async () => {
    const { dimensionValues } = await import("../../apps/console/lib/queries-dimensions");
    const selecteur = (dimension: string) => {
      const demande = dimensionValuesRequest({ dimension, app: FENETRE, authorizedApps: [FENETRE], range: fenetre() });
      if (!demande.ok) throw new Error(demande.error);
      return dimensionValues(demande.request, lireFenetre);
    };
    const colonnesV75 = async () => (await poolFenetre.query(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and column_name in ('browser', 'env')
          and table_name in ('rum_session', 'rum_pageview', 'rum_event_index')`,
    )).rows[0].n;
    expect(await colonnesV75()).toBe(0);

    await writeRows(poolFenetre, aplatir(ressource(web(FENETRE), visite("p61-fenetre-avant"))));
    // Déposé pendant la fenêtre, drainé après la migration : le lot porte déjà ses dimensions.
    await deposerLot(poolFenetre, FENETRE, aplatir(ressource(web(FENETRE, { "mip.release": "2.3.9" }), [pageview("p61-fenetre-file")])));
    for (const table of ["rum_session", "rum_pageview", "rum_metric", "rum_action", "rum_error", "rum_span", "rum_event_index"]) {
      const n = (await poolFenetre.query(`select count(*)::int as n from ${table} where app_id = $1`, [FENETRE])).rows[0].n;
      expect(n, table).toBeGreaterThan(0);
    }
    expect(await selecteur("browser")).toMatchObject({ available: false, values: [] });
    expect(await selecteur("release")).toMatchObject({ available: false, values: [] });
    // Colonne antérieure à v75 : le sélecteur répond déjà.
    expect(await selecteur("device")).toMatchObject({ available: true, values: [{ value: "desktop", count: 1 }] });

    await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v75.sql"), "utf8"));
    _resetColonnesCache();
    // rum_session.browser, rum_pageview.env, rum_event_index.env.
    expect(await colonnesV75()).toBe(3);
    await writeRows(poolFenetre, aplatir(ressource(web(FENETRE, { "mip.release": "2.4.0" }), [pageview("p61-fenetre-apres")])));
    expect(await drainerIngestRaw(poolFenetre, { log: muet })).toEqual({ drains: 1, echecs: 0 });

    expect((await poolFenetre.query(
      `select p.session_id, p.release, s.browser from rum_pageview p join rum_session s using (session_id)
        where p.app_id = $1 order by 1`,
      [FENETRE],
    )).rows).toEqual([
      // Écrite en v74 : l'ajout de colonne lui donne NULL.
      { session_id: "p61-fenetre-apres", release: "2.4.0", browser: "Chrome" },
      { session_id: "p61-fenetre-avant", release: null, browser: null },
      { session_id: "p61-fenetre-file", release: "2.3.9", browser: "Chrome" },
    ]);
    // Les neuf signaux indexés pendant la fenêtre restent inconnus : aucun backfill.
    expect(await selecteur("release")).toMatchObject({
      available: true, values: [{ value: "2.3.9", count: 1 }, { value: "2.4.0", count: 1 }], unknown: 9,
    });
  });
});
