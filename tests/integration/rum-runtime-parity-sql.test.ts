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
import { secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url } : {});
const APP = "p71-mobile-app";
const AUTRE = "p71-mobile-autre";
const BRUT = "alice@example.test";
const SECRET = "test-only-identity-secret";
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

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

// ────────────────── P7.3 — causalité, erreurs JS et démarrage ────────────────

/** Runtime mobile avec horloge monotone pilotée : la fenêtre causale se mesure. */
async function sdkCausal(appId: string) {
  vi.resetModules();
  const lots: Lot[] = [];
  let t = 0;
  const horloge = { nowMs: () => t, avance: (ms: number) => { t += ms; } };
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    lots.push(JSON.parse(init.body));
    return { status: 202 };
  });
  const sdk = await import("../../packages/rum-mobile/src/index");
  sdk.init({
    endpoint: "https://ingest.test/v1/traces",
    appId,
    apiKey: "mip_mob_p73",
    clientId: "acme",
    env: "prod",
    appVersion: "3.1.0",
    platform: "android",
    osVersion: "14",
    flushIntervalMs: 3_600_000,
    adapters: { monotonicClock: horloge },
  });
  return { sdk, lots, horloge };
}

suite("P7.3 — la causalité mobile jusqu'à PostgreSQL", () => {
  it("un appui relie ses effets, et ce qui suit la fenêtre reste non attribué", async () => {
    await nettoyer();
    const { sdk, lots, horloge } = await sdkCausal(APP);
    sdk.screen("Panier");
    const props = sdk.instrumentPressable({
      mipActionName: "checkout.payer",
      accessibilityLabel: "Payer la commande",
      onPress: () => { sdk.track("paiement_lance", { montant: 42 }); },
    });
    (props as { onPress: () => void }).onPress();

    // Hors fenêtre : un travail tardif n'est PAS rattaché au dernier appui.
    horloge.avance(5_001);
    sdk.track("beaucoup_plus_tard", { n: 1 });
    await sdk.flushNow();
    const rows = await ingerer(lots[lots.length - 1]);
    expect(rows.rejected).toBe(0);

    // L'action racine existe bel et bien en base, avec le type du geste observé.
    const action = (await pool.query(
      "select action_id, name, type from rum_action where app_id=$1", [APP],
    )).rows[0];
    expect(action).toMatchObject({ name: "checkout.payer", type: "click" });

    const parNom = Object.fromEntries((await pool.query(
      "select name, action_id from rum_event where app_id=$1", [APP],
    )).rows.map((r) => [r.name, r.action_id]));
    expect(parNom["paiement_lance"]).toBe(action.action_id);
    // La preuve décisive : l'effet tardif ne DÉSIGNE PAS l'action.
    expect(parNom["beaucoup_plus_tard"]).toBeNull();

    // Et le libellé affiché n'a jamais été collecté : seul le nom déclaré l'est.
    const dump = (await pool.query(
      "select coalesce(string_agg(t::text,'|'),'') d from rum_action t where app_id=$1", [APP],
    )).rows[0].d;
    expect(dump).not.toContain("Payer la commande");
  }, 60_000);

  it("un JS fatal est enregistré fatal et non intercepté, sans être un crash natif", async () => {
    await nettoyer();
    let handler: ((e: unknown, fatal: boolean) => void) | null = null;
    vi.stubGlobal("ErrorUtils", {
      getGlobalHandler: () => handler,
      setGlobalHandler: (h: (e: unknown, fatal: boolean) => void) => { handler = h; },
    });
    const { sdk, lots } = await sdkCausal(APP);
    handler!(new Error("plantage JS"), true);
    await sdk.flushNow();
    await ingerer(lots[lots.length - 1]);

    const erreur = (await pool.query(
      "select kind, handled, is_fatal, error_source from rum_error where app_id=$1", [APP],
    )).rows[0];
    // `is_fatal` valait NULL — « inconnu » — pour tous les crashes mobiles avant
    // ce lot : le handler recevait la fatalité du moteur et la jetait.
    expect(erreur).toMatchObject({
      kind: "crash", handled: false, is_fatal: true, error_source: "react_native_js",
    });
    vi.stubGlobal("ErrorUtils", undefined);
  }, 60_000);

  it("le démarrage JS est un timing nommé, lisible sans colonne nouvelle", async () => {
    await nettoyer();
    const { sdk, lots, horloge } = await sdkCausal(APP);
    horloge.avance(742);
    expect(sdk.markFirstScreenRendered()).toBe(true);
    await sdk.flushNow();
    await ingerer(lots[lots.length - 1]);

    const timing = (await pool.query(
      "select name, event_type, timing_ms from rum_event where app_id=$1", [APP],
    )).rows[0];
    // Aucune migration : P7.5 lit `rum_event` par son nom, comme n'importe quel
    // autre timing P2.
    expect(timing).toMatchObject({
      name: "js_start_to_first_screen_ms", event_type: "timing", timing_ms: 742,
    });
  }, 60_000);
});

// ─────────── P7.5 — capacités, runtime et lectures /mobile de bout en bout ───

/**
 * Modules console branchés sur la base jetable. `db.ts` lit DATABASE_URL à
 * l'évaluation et mémorise son pool sur globalThis : viser cette base exige
 * d'oublier ce pool ET le registre de modules.
 */
async function consoleMobile() {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = url;
  const mobile = await import("../../apps/console/lib/queries-mobile");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool: consolePool } = await import("../../apps/console/lib/db");
  schema.forgetDimensionSchema();
  return { ...mobile, consolePool };
}

const filtresMobile = (app: string) => ({
  app,
  period: "24h" as const,
  device: null,
  segment: [],
  includeBots: false,
  includeInternal: false,
});

const oublierCapacites = () =>
  pool.query("delete from mobile_capabilities where app_id = any($1::text[])", [[APP, AUTRE]]);

suite("P7.5 — du paquet réel jusqu'à l'écran /mobile", () => {
  it("le SDK déclare ses capacités, le serveur les valide, la console les lit", async () => {
    await nettoyer();
    await oublierCapacites();
    const { sdk, lots } = await sdkMobile(APP);
    sdk.screen("Accueil");
    sdk.addError(new Error("incident"), {});
    await sdk.flushNow();
    const rows = await ingerer(lots[lots.length - 1]);
    expect(rows.rejected).toBe(0);

    // 1. La session porte le RUNTIME déclaré, et non une déduction d'user-agent.
    const session = (await pool.query("select runtime, os from rum_session where app_id=$1", [APP])).rows[0];
    expect(session).toMatchObject({ runtime: "react_native", os: "iOS" });

    // 2. Les six capacités sont en base, pour cette app et cette release.
    const capacites = (await pool.query(
      "select capability, declared, release, runtime, verified_at from mobile_capabilities where app_id=$1 order by capability",
      [APP],
    )).rows;
    expect(capacites).toHaveLength(6);
    expect(capacites.every((c) => c.runtime === "react_native" && c.release === "3.1.0")).toBe(true);
    // Les trois natives sont déclarées INDISPONIBLES — pas absentes, pas à zéro.
    const parNom = Object.fromEntries(capacites.map((c) => [c.capability, c.declared]));
    expect(parNom.native_crashes).toBe(false);
    expect(parNom.anr).toBe(false);
    expect(parNom.native_start).toBe(false);
    // Et AUCUNE n'est vérifiée : l'ingestion ne peut pas écrire cette colonne.
    expect(capacites.every((c) => c.verified_at === null)).toBe(true);

    // 3. La console lit la même chose, avec ses trois états.
    const lib = await consoleMobile();
    const resume = await lib.mobileSummary(filtresMobile(APP));
    expect(resume.sessions.sessions).toBe(1);
    expect(resume.capabilities.find((c) => c.capability === "native_crashes")?.state).toBe("unavailable");
    expect(resume.capabilities.find((c) => c.capability === "anr")?.state).toBe("unavailable");
    // Aucun compte de crash natif n'existe dans la réponse : pas même un zéro.
    expect(JSON.stringify(resume)).not.toContain("native_crash_count");
    await lib.consolePool.end();
  }, 60_000);

  it("un lot rejoué ne double NI les signaux NI les déclarations de capacités", async () => {
    await nettoyer();
    await oublierCapacites();
    const { sdk, lots } = await sdkMobile(APP);
    sdk.screen("Accueil");
    sdk.track("achat", { n: 1 });
    await sdk.flushNow();
    const corps = lots[lots.length - 1];
    await ingerer(corps);
    await ingerer(corps); // même corps HTTP, deux fois : perte d'acquittement

    const compte = async (sql: string) => Number((await pool.query(sql, [APP])).rows[0].n);
    expect(await compte("select count(*)::int n from rum_session where app_id=$1")).toBe(1);
    expect(await compte("select count(*)::int n from rum_pageview where app_id=$1")).toBe(1);
    expect(await compte("select count(*)::int n from rum_event where app_id=$1")).toBe(1);
    // Six capacités, pas douze : l'upsert reconnaît la même (app, runtime, release).
    expect(await compte("select count(*)::int n from mobile_capabilities where app_id=$1")).toBe(6);
    // Et la table de capacités n'entre dans AUCUNE projection d'événements : un
    // lot qui ne fait que redéclarer n'ajoute rien au métering.
    expect(await compte("select count(*)::int n from rum_event_index where app_id=$1 and kind='capability'")).toBe(0);
  }, 60_000);

  it("A et B ne partagent ni cohorte, ni capacités", async () => {
    await nettoyer();
    await oublierCapacites();
    const a = await sdkMobile(APP);
    a.sdk.screen("A");
    await a.sdk.flushNow();
    await ingerer(a.lots[a.lots.length - 1]);

    const b = await sdkMobile(AUTRE);
    b.sdk.screen("B");
    await b.sdk.flushNow();
    await ingerer(b.lots[b.lots.length - 1]);

    const lib = await consoleMobile();
    const resumeA = await lib.mobileSummary(filtresMobile(APP));
    expect(resumeA.sessions.sessions).toBe(1);
    expect(resumeA.screens).toEqual([{ route: "A", views: 1, sessions: 1 }]);
    expect(resumeA.declarations).toHaveLength(6);
    const resumeB = await lib.mobileSummary(filtresMobile(AUTRE));
    expect(resumeB.screens).toEqual([{ route: "B", views: 1, sessions: 1 }]);
    await lib.consolePool.end();
  }, 60_000);

  it("un SDK mobile ANTÉRIEUR au modèle laisse ses capacités INCONNUES, pas à zéro", async () => {
    await nettoyer();
    await oublierCapacites();
    const nanos = `${Date.now()}000000`;
    const attr = (o: Record<string, string | number>) =>
      Object.entries(o).map(([key, v]) => ({
        key,
        value: typeof v === "number" ? { intValue: String(v) } : { stringValue: v },
      }));
    // Un lot d'un SDK 0.3 : le `service.name` est là, `mip.capabilities` non.
    await ingerer({
      resourceSpans: [{
        resource: { attributes: attr({ "service.name": "mip-rum-mobile", "mip.app_id": APP, "mip.release": "2.0.0" }) },
        scopeSpans: [{
          scope: { name: "@mip/rum-mobile", version: "0.3.0" },
          spans: [{
            traceId: "a".repeat(32), spanId: "b".repeat(16), name: "pageview",
            startTimeUnixNano: nanos, endTimeUnixNano: nanos,
            attributes: attr({ "mip.session_id": "p75-vieux", "mip.route": "Legacy", "mip.device_type": "android" }),
          }],
        }],
      }],
    });

    // Le runtime, lui, est bien reconnu : il vient du `service.name`, pas de la
    // déclaration de capacités.
    const session = (await pool.query("select runtime from rum_session where app_id=$1", [APP])).rows[0];
    expect(session.runtime).toBe("react_native");
    expect(Number((await pool.query(
      "select count(*)::int n from mobile_capabilities where app_id=$1", [APP],
    )).rows[0].n)).toBe(0);

    const lib = await consoleMobile();
    const resume = await lib.mobileSummary(filtresMobile(APP));
    expect(resume.sessions.sessions).toBe(1);
    // Six « Inconnu », et surtout PAS six « Non collecté » : un silence n'est pas
    // un refus, et un refus n'est pas un zéro.
    expect(resume.capabilities.every((c) => c.state === "unknown")).toBe(true);
    expect(resume.js_error_free_session_rate).toBeNull();
    expect(resume.js_error_free_unavailable_reason).toBe("capability_unknown");
    await lib.consolePool.end();
  }, 60_000);

  it("une erreur backend SANS session ne rejoint jamais la cohorte mobile", async () => {
    await nettoyer();
    await oublierCapacites();
    const { sdk, lots } = await sdkMobile(APP);
    sdk.screen("Accueil");
    await sdk.flushNow();
    await ingerer(lots[lots.length - 1]);

    // P7.4 : l'agent Node écrit une erreur SANS session et n'écrit AUCUNE ligne
    // `rum_session`. Elle doit rester hors de tout compteur de sessions mobiles.
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, handled, ts)
       values ('p75-backend-1', null, $1, 'échec backend', 'error', 7, 'node', true, now())`,
      [APP],
    );
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, name, event_type, ts)
       values ('p75-backend-2', null, $1, 'job_termine', 'custom', now())`,
      [APP],
    );

    const lib = await consoleMobile();
    const resume = await lib.mobileSummary(filtresMobile(APP));
    // Une session observée (celle du mobile), et l'erreur backend n'en ajoute pas.
    expect(resume.sessions.sessions).toBe(1);
    expect(resume.js_errors?.occurrences).toBe(0);
    expect(resume.js_errors?.sessions_affected).toBe(0);
    await lib.consolePool.end();
  }, 60_000);
});
