// P7.1 — le round-trip complet, sur PostgreSQL réel.
//
// Le payload n'est pas écrit à la main : il est produit par le VRAI paquet
// `@mip/rum-mobile` (init + API publiques), puis traverse la chaîne entière —
// HMAC app-scopé (`identity-hash`), parseur (`otlp.mjs`), writer
// (`pg-ingest.mjs`), tables. Un test qui fabriquerait les attributs lui-même
// prouverait que le parseur lit ce qu'on lui donne, pas que le SDK l'émet.
//
// Trois exigences vérifiées ici et nulle part ailleurs :
//   1. les signaux P2 du mobile atterrissent dans les mêmes tables que le web ;
//   2. aucune identité brute ne survit en base, et `mip.user_hash` legacy n'est
//      plus présenté comme une identité personnelle ;
//   3. un SDK mobile de la version PRÉCÉDENTE continue d'être ingéré.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error module JS sans déclarations
import { secureOtlpIdentities } from "../../apps/ingest/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "p71-mobile-app";
const AUTRE = "p71-mobile-autre";
const BRUT = "alice@example.test";
const SECRET = "test-only-identity-secret";
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");

type Lot = Record<string, any>;

/** Runtime mobile neuf : l'état de module est un singleton, comme en production. */
async function sdkMobile(appId: string) {
  vi.resetModules();
  const lots: Lot[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    lots.push(JSON.parse(init.body));
    return { status: 202 };
  });
  const sdk = await import("../../packages/rum-mobile/src/index");
  sdk.init({
    endpoint: "https://ingest.test/v1/traces",
    appId,
    apiKey: "mip_mob_p71",
    clientId: "acme",
    env: "prod",
    appVersion: "3.1.0",
    platform: "ios",
    osVersion: "17",
    flushIntervalMs: 60_000,
  });
  return { sdk, lots };
}

/** Chaîne d'ingestion réelle : HMAC serveur -> parseur -> writer. */
async function ingerer(payload: unknown) {
  const rows = flattenOtlp(secureOtlpIdentities(payload, SECRET).payload);
  await writeRows(pool, rows);
  return rows;
}

async function nettoyer() {
  for (const app of [APP, AUTRE]) {
    for (const table of [
      "rum_event_index", "rum_action", "rum_event", "rum_error",
      "rum_pageview", "rum_span", "rum_session",
    ]) {
      await pool.query(`delete from ${table} where app_id=$1`, [app]);
    }
  }
}

beforeAll(async () => {
  if (!url) return;
  const migrations = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const file of migrations) await pool.query(readFileSync(join(SQL_DIR, file), "utf8"));
  for (const app of [APP, AUTRE]) {
    await pool.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
  await nettoyer();
}, 180_000);

afterAll(async () => {
  if (!url) return;
  vi.unstubAllGlobals();
  await nettoyer();
  await pool.query("delete from app_registry where app_id=any($1::text[])", [[APP, AUTRE]]);
  await pool.end();
});

suite("P7.1 — round-trip React Native jusqu'à PostgreSQL", () => {
  it("écrit session, page vue, erreur, action et événements P2 dans les mêmes tables que le web", async () => {
    await nettoyer();
    const { sdk, lots } = await sdkMobile(APP);
    sdk.setGlobalContext({ plan: "pro", essai: false });
    sdk.setUser({ id: BRUT, role: "admin" });
    sdk.setAccount("customer-42");
    sdk.screen("Accueil");
    sdk.startView("Checkout", { etape: 1 });
    sdk.addAction("Payer");
    sdk.addTiming("prete");
    sdk.addFeatureFlagEvaluation("nouveau_tunnel", true);
    sdk.addError(new Error(`incident de ${BRUT}`), { panier: 3 }, { fingerprint: "checkout-v1" });
    sdk.track("checkout", { amount: 42, ok: true, absent: null, email: BRUT });
    await sdk.flushNow();
    const rows = await ingerer(lots[lots.length - 1]);
    expect(rows.rejected).toBe(0);

    const session = (await pool.query(
      "select device_type, os, os_version, browser, release, visitor_id, user_hash, user_id_hash, account_id_hash, context from rum_session where app_id=$1",
      [APP],
    )).rows[0];
    // P6.1 : « ios » est une PLATEFORME, pas une classe d'appareil.
    expect(session).toMatchObject({ device_type: "mobile", os: "iOS", os_version: "17", browser: null, release: "3.1.0" });
    // L'ancienne empreinte d'appareil n'est plus émise ; le visiteur, lui, est un
    // tirage aléatoire du lancement — la seule clef exploitable par un DSAR.
    expect(session.user_hash).toBeNull();
    expect(session.visitor_id).toMatch(/^[0-9a-f-]{32,36}$/);
    expect(session.user_id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.account_id_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(Number((await pool.query("select count(*)::int n from rum_pageview where app_id=$1", [APP])).rows[0].n)).toBe(1);

    const erreur = (await pool.query(
      "select message, kind, handled, is_fatal, error_source, release from rum_error where app_id=$1",
      [APP],
    )).rows[0];
    expect(erreur).toMatchObject({ handled: true, error_source: "react_native_js", is_fatal: null, release: "3.1.0" });
    expect(erreur.message).toContain("[email]");

    const action = (await pool.query("select name, type from rum_action where app_id=$1", [APP])).rows[0];
    expect(action).toMatchObject({ name: "Payer", type: "manual" });

    const evenements = (await pool.query(
      "select event_type, name, view_name, timing_ms, feature_flag_value, props, context from rum_event where app_id=$1 order by event_type",
      [APP],
    )).rows;
    expect(evenements.map((e) => e.event_type)).toEqual(["action", "custom", "feature_flag", "timing", "view"]);
    const parType = Object.fromEntries(evenements.map((e) => [e.event_type, e]));
    expect(parType.view).toMatchObject({ name: "Checkout", view_name: "Checkout" });
    expect(parType.timing.timing_ms).not.toBeNull();
    expect(parType.feature_flag.feature_flag_value).toBe("true");
    // Types exacts de bout en bout : booléen, nombre et null traversent le jsonb.
    expect(parType.custom.props).toEqual({ amount: 42, ok: true, absent: null, email: "[redacted]" });
    expect(parType.custom.context).toMatchObject({ plan: "pro", essai: false, role: "admin" });

    // La projection d'événements P1 reçoit bien les signaux mobiles.
    expect(Number((await pool.query(
      "select count(*)::int n from rum_event_index where app_id=$1", [APP],
    )).rows[0].n)).toBeGreaterThanOrEqual(7);

    // Aucune identité brute nulle part : le HMAC est app-scopé et serveur.
    for (const table of ["rum_session", "rum_event", "rum_error", "rum_event_index"]) {
      const dump = (await pool.query(
        `select coalesce(string_agg(t::text, '|'), '') as d from ${table} t where app_id=$1`, [APP],
      )).rows[0].d;
      expect(dump).not.toContain(BRUT);
    }
  }, 60_000);

  it("ne joint jamais deux applications : même identité, hash différent", async () => {
    await nettoyer();
    const a = await sdkMobile(APP);
    a.sdk.setUser(BRUT);
    a.sdk.track("achat", { n: 1 });
    await a.sdk.flushNow();
    await ingerer(a.lots[a.lots.length - 1]);

    const b = await sdkMobile(AUTRE);
    b.sdk.setUser(BRUT);
    b.sdk.track("achat", { n: 1 });
    await b.sdk.flushNow();
    await ingerer(b.lots[b.lots.length - 1]);

    const hashes = (await pool.query(
      "select app_id, user_id_hash from rum_session where app_id=any($1::text[]) order by app_id",
      [[APP, AUTRE]],
    )).rows;
    expect(hashes).toHaveLength(2);
    expect(hashes[0].user_id_hash).not.toBe(hashes[1].user_id_hash);
    // Et aucun événement de A ne fuit dans le périmètre de B.
    expect(Number((await pool.query(
      "select count(*)::int n from rum_event where app_id=$1", [AUTRE],
    )).rows[0].n)).toBe(1);
  }, 60_000);

  it("continue d'ingérer un SDK mobile de la version précédente (v0.1)", async () => {
    await nettoyer();
    const nanos = `${Date.now()}000000`;
    const attr = (o: Record<string, string | number>) =>
      Object.entries(o).map(([key, value]) => ({
        key,
        value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
      }));
    // Forme EXACTE de l'ancien `buildPayload` : `mip.user_hash`, aucun visiteur,
    // aucun `mip.event_type`, aucun champ OTLP natif.
    const ancien = {
      resourceSpans: [{
        resource: {
          attributes: attr({
            "service.name": "mip-rum-mobile",
            "service.version": "0.1.0",
            "mip.app_id": APP,
            "mip.client_id": "acme",
            "mip.user_agent": "MIP-RN/0.1 (android 14)",
            "deployment.environment.name": "prod",
            "mip.release": "1.0.0",
          }),
        },
        scopeSpans: [{
          scope: { name: "@mip/rum-mobile", version: "0.1.0" },
          spans: [
            {
              traceId: "aa11bb22cc33dd44".padStart(32, "0"),
              spanId: "aa11bb22cc33dd44",
              name: "pageview",
              startTimeUnixNano: nanos,
              endTimeUnixNano: nanos,
              attributes: attr({
                "mip.session_id": "legacy-session",
                "mip.route": "Accueil",
                "mip.user_hash": "empreinte-appareil-legacy",
                "mip.tz": "Europe/Paris",
                "mip.device_type": "android",
                "mip.collection_source": "sdk",
                "mip.url": "Accueil",
                "mip.nav_type": "screen",
              }),
            },
            {
              traceId: "bb22cc33dd44ee55".padStart(32, "0"),
              spanId: "bb22cc33dd44ee55",
              name: "track.checkout",
              startTimeUnixNano: nanos,
              endTimeUnixNano: nanos,
              attributes: attr({
                "mip.session_id": "legacy-session",
                "mip.route": "Accueil",
                "mip.device_type": "android",
                "mip.props": JSON.stringify({ amount: 7 }),
              }),
            },
          ],
        }],
      }],
    };
    const rows = await ingerer(ancien);
    expect(rows.rejected).toBe(0);

    const session = (await pool.query(
      "select device_type, os, visitor_id, user_hash, id_kind from rum_session where app_id=$1", [APP],
    )).rows[0];
    expect(session).toMatchObject({ device_type: "mobile", os: "Android" });
    // L'ancienne empreinte est ACCEPTÉE — refuser perdrait la télémétrie d'un
    // SDK déjà posé — mais la session reste marquée comme non rattachable.
    expect(session.user_hash).toBe("empreinte-appareil-legacy");
    expect(session.visitor_id).toBeNull();
    expect(session.id_kind).not.toBe("visitor");
    expect(Number((await pool.query(
      "select count(*)::int n from rum_event where app_id=$1", [APP],
    )).rows[0].n)).toBe(1);
  }, 60_000);
});

// ───────────────────── P7.2 — acquittement et idempotence ────────────────────
//
// LA QUESTION À LAQUELLE CE BLOC RÉPOND. Le transport mobile ne retire un lot
// qu'après acquittement HTTP. Que se passe-t-il quand le serveur a ÉCRIT le lot
// mais que l'acquittement se perd — tunnel, coupure TLS, application tuée ? Le
// client rejoue. Si le rejeu créait de nouveaux identifiants, chaque perte
// d'acquittement doublerait une session, une erreur, un événement, et les
// compteurs produit deviendraient faux sans qu'aucune alerte ne se déclenche.
//
// Ce test ne simule pas le parseur : il prend les DEUX corps HTTP réellement
// émis par le SDK et les fait traverser la chaîne complète, deux fois.

/** Runtime mobile dont la première tentative échoue, la seconde réussit. */
async function sdkAvecAcquittementPerdu(appId: string) {
  vi.resetModules();
  const lots: Lot[] = [];
  let premiere = true;
  const horloge = { t: 0, nowMs() { return this.t; } };
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    lots.push(JSON.parse(init.body));
    if (premiere) {
      premiere = false;
      // Le serveur a écrit, mais le client n'apprendra jamais qu'il a écrit.
      throw new Error("connexion interrompue apres commit");
    }
    return { status: 202, headers: { get: () => null } };
  });
  const sdk = await import("../../packages/rum-mobile/src/index");
  sdk.init({
    endpoint: "https://ingest.test/v1/traces",
    appId,
    apiKey: "mip_mob_p72",
    clientId: "acme",
    env: "prod",
    appVersion: "3.1.0",
    platform: "ios",
    osVersion: "17",
    flushIntervalMs: 3_600_000,
    adapters: { monotonicClock: horloge },
  });
  return { sdk, lots, horloge };
}

/** Identifiants de span d'un lot, triés — la clef d'idempotence de l'ingestion. */
function idsDe(lot: Lot): string[] {
  return lot.resourceSpans
    .flatMap((rs: Lot) => rs.scopeSpans.flatMap((ss: Lot) => ss.spans))
    .map((s: Lot) => s.spanId)
    .sort();
}

suite("P7.2 — un même événement acquitté deux fois ne compte qu'une occurrence", () => {
  it("rejoue le lot à l'identique et n'écrit qu'une ligne par signal", async () => {
    await nettoyer();
    const { sdk, lots, horloge } = await sdkAvecAcquittementPerdu(APP);
    sdk.setUser({ id: BRUT, role: "admin" });
    sdk.screen("Accueil");
    sdk.startView("Checkout", { etape: 1 });
    sdk.addAction("Payer");
    sdk.addError(new Error("incident de paiement"), { panier: 3 });
    sdk.track("checkout", { amount: 42 });

    // Première tentative : le serveur écrit, l'acquittement se perd.
    await sdk.flushNow();
    expect(lots).toHaveLength(1);
    const commit = await ingerer(lots[0]);
    expect(commit.rejected).toBe(0);
    // Rien n'a été retiré côté client : sans acquittement, rien ne bouge.
    expect(sdk.getDiagnostics().queued).toBeGreaterThan(0);
    expect(sdk.getDiagnostics().retries).toBe(1);

    // Seconde tentative, après l'échéance du retrait exponentiel.
    horloge.t += 10 * 60_000;
    await sdk.flushNow();
    expect(lots).toHaveLength(2);
    expect(sdk.getDiagnostics().queued).toBe(0);

    // Les identifiants OTLP sont RIGOUREUSEMENT les mêmes : c'est la seule
    // raison pour laquelle l'ingestion peut appliquer ses `on conflict`.
    expect(idsDe(lots[1])).toEqual(idsDe(lots[0]));

    const rejeu = await ingerer(lots[1]);
    expect(rejeu.rejected).toBe(0);

    // Une seule occurrence de chaque signal, et une seule session.
    const compte = async (table: string) =>
      Number((await pool.query(`select count(*)::int n from ${table} where app_id=$1`, [APP])).rows[0].n);
    expect(await compte("rum_session")).toBe(1);
    expect(await compte("rum_pageview")).toBe(1);
    expect(await compte("rum_error")).toBe(1);
    expect(await compte("rum_action")).toBe(1);
    // vue + action + événement métier = 3 lignes d'événements, pas 6.
    expect(await compte("rum_event")).toBe(3);

    // Et la projection P1 ne double pas davantage : autant de lignes que de
    // spans distincts.
    const total = Number((await pool.query(
      "select count(*)::int n from rum_event_index where app_id=$1", [APP],
    )).rows[0].n);
    const distincts = Number((await pool.query(
      "select count(distinct (kind, source_span_id))::int n from rum_event_index where app_id=$1", [APP],
    )).rows[0].n);
    expect(total).toBe(distincts);
  }, 60_000);

  it("l'événement rejoué garde l'identité de son émission, pas celle du moment", async () => {
    await nettoyer();
    const { sdk, lots, horloge } = await sdkAvecAcquittementPerdu(APP);
    sdk.setUser(BRUT);
    sdk.track("achat_alice", { amount: 1 });
    await sdk.flushNow();

    // L'utilisateur change AVANT que le lot ne parte réellement.
    sdk.setUser("bob@example.test");
    horloge.t += 10 * 60_000;
    await sdk.flushNow();
    expect(lots).toHaveLength(2);
    await ingerer(lots[1]);

    const hash = (await pool.query(
      "select user_id_hash from rum_event where app_id=$1 and name=$2", [APP, "achat_alice"],
    )).rows[0].user_id_hash;

    // Référence : le hash serveur de l'identité d'ORIGINE, calculé séparément.
    const reference = flattenOtlp(secureOtlpIdentities(lots[0], SECRET).payload).events[0].user_id_hash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Jamais de réattribution au flush : ce serait inventer un achat de Bob.
    expect(hash).toBe(reference);
  }, 60_000);
});
