// Migration-v109 — l'écriture d'un lot en UN aller-retour, comparée à l'ancien
// chemin sur un VRAI PostgreSQL.
//
// LA PREUVE D'ÉQUIVALENCE. Chaque scénario est joué DEUX fois sur une base remise
// à zéro : par le chemin historique (`chemin: "historique"`), puis par la fonction
// SQL (`chemin: "un_ar"`). Les deux doivent rendre les MÊMES bilans (ou les mêmes
// refus) et laisser les MÊMES lignes dans toutes les tables écrites — colonne par
// colonne, hors identifiants séquentiels et horodatages posés par `now()`. Les
// lots viennent du VRAI parser (`flattenOtlp`, `flattenOtlpLogs`), identités
// hachées comme au port d'ingestion.
//
// LA BARRIÈRE. Sur le nouveau chemin : un effacement qui tient le verrou fait
// attendre l'écriture, qui voit ensuite la barrière et refuse le sujet ; un verrou
// indisponible rend la même erreur identifiée qu'avant, sans rien écrire.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm vitest run tests/integration/ingest-un-ar-sql.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetColonnesCache, writeLogs, writeReplayChunk, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetUnAR, choisirChemin } from "../../packages/backend/lib/ingest-un-ar.mjs";
// @ts-expect-error module JS sans déclarations
import { VERROU_INGESTION_NS, _resetPresenceBarrieres } from "../../packages/backend/lib/privacy-barriere.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 6 } : { max: 6 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP = "v109-a";
const AUTRE = "v109-b";
const MOBILE = "v109-m";
const APPS = [APP, AUTRE, MOBILE];
const SECRET = "test-only-identity-secret";
const ALICE = "alice@v109.test";
const BOB = "bob@v109.test";
const NOW = Date.UTC(2026, 9, 6, 10, 0, 0);
const sansSymbolication = null;

type Chemin = "historique" | "un_ar";
type Ligne = Record<string, unknown>;

function attributs(valeurs: Record<string, string | number | boolean>) {
  return Object.entries(valeurs).map(([key, value]) => ({
    key,
    value: typeof value === "number"
      ? { doubleValue: value }
      : typeof value === "boolean" ? { boolValue: value } : { stringValue: String(value) },
  }));
}

let compteur = 0;
const spanId = () => (0x7910_0000_0000_0000n + BigInt(++compteur)).toString(16);
const hex32 = (n: number) => n.toString(16).padStart(32, "0");

/** Un span OTLP du SDK web, horodaté près de NOW. */
function span(nom: string, session: string, extra: Record<string, string | number | boolean>, decalageMs = 0) {
  const ns = BigInt(NOW - 60_000 + decalageMs) * 1_000_000n;
  return {
    name: nom,
    traceId: "c".repeat(32),
    spanId: spanId(),
    startTimeUnixNano: ns.toString(),
    endTimeUnixNano: (ns + 5_000_000n).toString(),
    attributes: attributs({ "mip.session_id": session, "mip.route": "/panier", ...extra }),
  };
}

/**
 * Un lot riche : page vue, vitals (CLS rapporté deux fois sous le même
 * `webvital.id`, FCP sans identifiant), ressource, tâche longue, LoAF, fil
 * d'Ariane, appel HTTP, événement, action, exception ; une identité hachée.
 */
function lotRiche(app: string, session: string, raw: string | null, { cls = [0.05, 0.12], page = "/panier" } = {}) {
  const id = raw ? { "mip.identity.user_id": raw } : {};
  const action = hex32(compteur + 1000);
  const spans = [
    span("pageview", session, {
      ...id, "mip.visitor_id": `v-${session}`, "mip.url": `https://v109.test${page}?q=1`, "mip.nav_type": "navigate",
      "mip.device_type": "desktop", "mip.tz": "Europe/Paris", "mip.net_type": "4g", "mip.context": JSON.stringify({ plan: "pro" }),
    }),
    span("webvital.LCP", session, { ...id, "webvital.name": "LCP", "webvital.value": 1234, "webvital.id": `${session}-lcp` }, 10),
    ...cls.map((v, i) => span("webvital.CLS", session, { "webvital.name": "CLS", "webvital.value": v, "webvital.id": `${session}-cls` }, 20 + i)),
    span("webvital.FCP", session, { "webvital.name": "FCP", "webvital.value": 800 }, 30),
    span("resource", session, { "resource.url": "https://cdn.v109.test/app.js", "resource.type": "script", "resource.duration_ms": 120, "resource.transfer_size": 2048, "resource.render_blocking": true }, 40),
    span("longtask", session, { "longtask.duration_ms": 80 }, 50),
    span("loaf", session, { "loaf.duration_ms": 120, "loaf.blocking_ms": 70.5, "loaf.render_ms": 10.25, "loaf.script_url": "https://cdn.v109.test/app.js", "loaf.script_function": "payer", "loaf.script_ms": 60.125, "loaf.invoker": "click" }, 60),
    span("breadcrumb", session, { "breadcrumb.type": "click", "breadcrumb.label": "Payer", "breadcrumb.seq": 3 }, 70),
    span("http.client", session, { "mip.trace_id": "d".repeat(32), "mip.span_id": spanId(), "http.duration_ms": 45, "http.method": "GET", "http.status_code": 200, "http.url": "https://api.v109.test/panier" }, 80),
    span("track.ajout_panier", session, { ...id, "mip.props": JSON.stringify({ montant: 12, devise: "EUR" }) }, 90),
    span("rum.action", session, { ...id, "mip.event_type": "action", "mip.event_name": "Payer", "mip.action_id": action, "mip.action_type": "click" }, 100),
    span("exception", session, { ...id, "exception.type": "TypeError", "exception.message": "x is undefined", "exception.stacktrace": "TypeError: x is undefined\n    at payer (https://cdn.v109.test/app.js:1:200)" }, 110),
  ];
  return flattenOtlp(secureOtlpIdentities({
    resourceSpans: [{
      resource: { attributes: attributs({ "mip.app_id": app, "mip.client_id": "v109", "mip.release": "1.2.3", "service.name": "mip-rum-web",
        "deployment.environment": "prod", "mip.user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" }) },
      scopeSpans: [{ scope: { name: "@mip/rum-sdk" }, spans }],
    }],
  }, SECRET).payload, { now: NOW });
}

/** Un lot mobile : capacités déclarées et une page vue. */
function lotMobile(session: string, declaration: string) {
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: attributs({ "mip.app_id": MOBILE, "service.name": "mip-rum-mobile", "mip.release": "2.0.0", "mip.capabilities": declaration }) },
      scopeSpans: [{ spans: [span("pageview", session, { "mip.url": "app://accueil" })] }],
    }],
  }, { now: NOW });
}

/** Deux personnes dans UN lot. */
function fusion(a: Record<string, unknown>, b: Record<string, unknown>) {
  const sortie: Record<string, unknown> = {};
  for (const cle of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ga = a[cle];
    const gb = b[cle];
    sortie[cle] = Array.isArray(ga) && Array.isArray(gb) ? [...ga, ...gb] : (ga ?? gb);
  }
  return sortie;
}

function lotLogs(app: string, session: string) {
  const ns = (BigInt(NOW - 30_000) * 1_000_000n).toString();
  return flattenOtlpLogs({
    resourceLogs: [{
      resource: { attributes: attributs({ "mip.app_id": app, "service.name": "api-v109" }) },
      scopeLogs: [{ logRecords: [
        { timeUnixNano: ns, severityNumber: 9, body: { stringValue: "commande créée" }, attributes: attributs({ "mip.session_id": session, "mip.route": "/commande" }) },
        { timeUnixNano: ns, severityNumber: 17, traceId: "e".repeat(32), spanId: "f".repeat(16), body: { stringValue: "échec du paiement" },
          attributes: attributs({ "mip.session_id": session, "exception.type": "PaymentError", "exception.message": "refusé", "exception.stacktrace": "PaymentError: refusé\n  at pay (pay.py:12)" }) },
      ] }],
    }],
  }, { now: NOW });
}

const chunk = (app: string, session: string, seq: number) => ({
  appId: app, sessionId: session, seq, eventsCount: 2, body: gzipSync(Buffer.from(JSON.stringify([{ t: 1 }, { t: 2 }]))),
});

// ───────────────────────────── Instantané ──────────────────────────────────

/** Tables écrites par l'ingestion, et ce qui n'y est pas comparable (séquences, now()). */
const TABLES: Record<string, string[]> = {
  rum_session: [],
  rum_pageview: ["id"],
  rum_metric: ["id"],
  rum_action: [],
  rum_error: ["id", "ingested_at"],
  rum_resource: ["id"],
  rum_longtask: ["id"],
  rum_breadcrumb: ["id"],
  rum_event: ["id"],
  rum_span: ["id"],
  rum_event_index: ["id"],
  rum_log: ["id", "created_at"],
  replay_chunk: ["id", "created_at"],
  mobile_capabilities: ["id", "first_declared_at", "last_declared_at"],
};

async function instantane(): Promise<Record<string, string[]>> {
  const sortie: Record<string, string[]> = {};
  for (const [table, exclues] of Object.entries(TABLES)) {
    const { rows } = await pool.query(`select * from ${table} where app_id = any($1::text[])`, [APPS]);
    sortie[table] = rows
      .map((r: Ligne) => {
        for (const c of exclues) delete r[c];
        if (Buffer.isBuffer(r.body)) r.body = r.body.toString("hex");
        // Une issue reçoit un uuid aléatoire ; seule sa présence se compare.
        if ("issue_id" in r) r.issue_id = r.issue_id == null ? null : "<uuid>";
        // Une session minimale (créée par un chunk de rejeu) porte `now()` :
        // l'horloge du test, pas celle des lots, qui datent de NOW.
        for (const [c, v] of Object.entries(r)) if (v instanceof Date && v.getTime() > NOW + 3_600_000) r[c] = "<now()>";
        return JSON.stringify(r, Object.keys(r).sort());
      })
      .sort();
  }
  return sortie;
}

async function nettoyer() {
  for (const t of [...Object.keys(TABLES).filter((t) => t !== "rum_session"), "rum_session", "privacy_erasure_barrier", "error_issue_alias", "error_issue"]) {
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
  }
  await pool.query("delete from error_grouping_config where app_id = any($1::text[])", [APPS]);
  _resetPresenceBarrieres();
  _resetColonnesCache();
  _resetUnAR(pool);
}

type Etape = (chemin: Chemin) => Promise<unknown>;

/** Joue un scénario par un chemin, sur une base remise à zéro : bilans (ou refus) et lignes. */
async function jouer(chemin: Chemin, etapes: Etape[]) {
  await nettoyer();
  const bilans: unknown[] = [];
  for (const etape of etapes) {
    try {
      bilans.push(await etape(chemin));
    } catch (err) {
      const e = err as Error;
      bilans.push({ erreur: e.name, message: e.message });
    }
  }
  return { bilans, lignes: await instantane() };
}

async function equivalents(etapes: Etape[]) {
  const historique = await jouer("historique", etapes);
  const unAR = await jouer("un_ar", etapes);
  expect(unAR.bilans).toEqual(historique.bilans);
  expect(unAR.lignes).toEqual(historique.lignes);
  return historique;
}

const traces = (rows: unknown, extra: Record<string, unknown> = {}): Etape => (chemin) =>
  writeRows(pool, rows, { chemin, symbolicateur: sansSymbolication, ...extra });
const logs = (lot: { logs: unknown[]; errors: unknown[] }): Etape => (chemin) => writeLogs(pool, lot.logs, lot.errors, { chemin });
const rejeu = (c: ReturnType<typeof chunk>): Etape => (chemin) => writeReplayChunk(pool, c, { chemin });
const sql = (texte: string, params: unknown[] = []): Etape => async () => { await pool.query(texte, params); return "sql"; };

beforeAll(async () => {
  if (!url) return;
  const fichiers = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const f of fichiers) await pool.query(readFileSync(join(SQL_DIR, f), "utf8"));
  for (const app of APPS) {
    await pool.query(
      `insert into app_registry (app_id, name, active, privacy_barrier_mode) values ($1, $1, true, 'off')
       on conflict (app_id) do update set active = true, privacy_barrier_mode = 'off'`,
      [app],
    );
  }
}, 300_000);

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
  await pool.end();
});

beforeEach(async () => {
  if (!url) return;
  await pool.query("update app_registry set privacy_barrier_mode = 'off' where app_id = any($1::text[])", [APPS]);
});

suite("migration-v109 — mêmes lignes, mêmes refus, par les deux chemins", () => {
  it("un parcours complet : lot riche, second lot (CLS qui grandit), rejeu du premier, logs, capacités, rejeu", async () => {
    const lot1 = lotRiche(APP, "s-v109-1", ALICE);
    const lot2 = lotRiche(APP, "s-v109-1", ALICE, { cls: [0.3], page: "/paiement" });
    const { bilans, lignes } = await equivalents([
      traces(lot1),
      traces(lot2),
      traces(lot1),
      logs(lotLogs(APP, "s-v109-1")),
      traces(lotMobile("s-v109-m", "js_errors:active,anr:unavailable")),
      traces(lotMobile("s-v109-m", "js_errors:active,anr:active")),
      rejeu(chunk(APP, "s-v109-1", 1)),
      rejeu(chunk(APP, "s-v109-1", 1)),
      rejeu(chunk(APP, "s-v109-neuve", 1)),
    ]);
    // Le scénario exerce bien ce qu'il prétend comparer.
    expect(lignes.rum_session.length).toBe(3);
    expect(lignes.rum_metric.length).toBeGreaterThanOrEqual(3);
    // Deux exceptions de traces (une par lot) et celle que porte le log ERROR.
    expect(lignes.rum_error.length).toBe(3);
    expect(lignes.rum_log.length).toBe(2);
    expect(lignes.rum_event_index.length).toBeGreaterThan(5);
    expect(lignes.mobile_capabilities.length).toBe(2);
    expect(lignes.replay_chunk.length).toBe(2);
    expect(lignes.rum_action.length).toBe(2);
    // Le rejeu du premier lot n'insère aucune erreur de plus.
    expect((bilans[2] as { erreurs: { inserees: number } }).erreurs.inserees).toBe(0);
    // Le CLS consolidé garde la plus grande valeur.
    const cls = lignes.rum_metric.map((l) => JSON.parse(l)).filter((m) => m.name === "CLS");
    expect(cls.map((m) => m.value)).toEqual([0.3]);
  });

  it("toutes les colonnes que le parser remplit sont écrites, et identiques", async () => {
    const { lignes } = await jouer("un_ar", [traces(lotRiche(APP, "s-v109-col", BOB))]);
    const session = JSON.parse(lignes.rum_session[0]);
    for (const c of ["visitor_id", "user_id_hash", "context", "browser", "os", "runtime", "release", "net_type", "geo_country"]) {
      expect(session[c], c).not.toBeNull();
    }
    const longtask = lignes.rum_longtask.map((l) => JSON.parse(l)).find((l) => l.source === "loaf");
    expect(longtask.blocking_ms).toBe(70.5);
    expect(longtask.script_ms).toBe(60.125);
  });

  it("une exception qui revendique une session : rattachée si elle existe dans la MÊME app, sinon sans session", async () => {
    const base = lotRiche(APP, "s-v109-claim", null);
    const derivee = (base.errors as Ligne[])[0];
    const revendications = {
      ...base,
      errors: [
        { ...derivee, span_id: spanId(), session_id: null, session_claim: "s-v109-claim" },
        { ...derivee, span_id: spanId(), session_id: null, session_claim: "s-v109-inconnue" },
      ],
    };
    const { lignes } = await equivalents([traces(base), traces(revendications)]);
    const sessions = lignes.rum_error.map((l) => JSON.parse(l).session_id).sort();
    expect(sessions).toEqual([null, "s-v109-claim", "s-v109-claim"].sort());
  });

  it("la barrière : la personne effacée part d'un lot mixte, l'autre reste ; mêmes refus comptés", async () => {
    const userHash = hashIdentity(SECRET, APP, "user", ALICE);
    const { bilans, lignes } = await equivalents([
      sql(`insert into privacy_erasure_barrier (app_id, subject_kind, subject_key) values ($1, 'user', $2)`, [APP, userHash]),
      sql(`insert into privacy_erasure_barrier (app_id, subject_kind, subject_key) values ($1, 'session', 's-v109-efface')`, [APP]),
      traces(fusion(lotRiche(APP, "s-v109-alice", ALICE), lotRiche(APP, "s-v109-bob", BOB))),
      rejeu(chunk(APP, "s-v109-alice", 1)),
      rejeu(chunk(APP, "s-v109-efface", 1)),
      traces(lotRiche(APP, "s-v109-efface", null)),
    ]);
    expect((bilans[2] as { refuses: Record<string, number> }).refuses.sessions).toBe(1);
    expect((bilans[4] as { etat: string }).etat).toBe("refus_barriere");
    // Alice (identité effacée) et la session effacée sont refusées ; Bob reste. Le
    // chunk de rejeu d'Alice, lui, ne connaît que sa session (aucune barrière de
    // session, application en `off`) : il pose l'ancre minimale, comme avant v109.
    expect(lignes.rum_pageview.map((l) => JSON.parse(l).session_id)).toEqual(["s-v109-bob"]);
    expect(lignes.rum_session.map((l) => JSON.parse(l)).filter((s) => s.user_id_hash).map((s) => s.session_id)).toEqual(["s-v109-bob"]);
  });

  it("sous `enforce`, un chunk sans ancre attend ; la portée d'application refuse la voisine", async () => {
    const { bilans } = await equivalents([
      sql(`update app_registry set privacy_barrier_mode = 'enforce' where app_id = $1`, [APP]),
      rejeu(chunk(APP, "s-v109-sans-ancre", 1)),
      traces(lotRiche(AUTRE, "s-v109-partagee", null)),
      traces(lotRiche(APP, "s-v109-partagee", null)),
      rejeu(chunk(APP, "s-v109-partagee", 1)),
    ]);
    expect((bilans[1] as { etat: string }).etat).toBe("attente_session");
    expect(bilans[3]).toMatchObject({ erreur: "ErreurPorteeApp" });
    expect(bilans[4]).toMatchObject({ erreur: "ErreurPorteeApp" });
  });

  it("le regroupement v2 actif : le nouveau chemin se replie, et l'issue est créée comme avant", async () => {
    const { lignes } = await equivalents([
      sql(`insert into error_grouping_config (app_id, active_version) values ($1, 2)`, [APP]),
      traces(lotRiche(APP, "s-v109-v2", null)),
    ]);
    expect(JSON.parse(lignes.rum_error[0]).issue_id).not.toBeNull();
  });
});

suite("migration-v109 — un seul aller-retour, et la barrière d'effacement tient", () => {
  /** Les requêtes que `pg` envoie pendant `fn`, sur toutes les connexions. */
  async function requetesDe(fn: () => Promise<unknown>) {
    const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
    const original = proto.query;
    const vues: string[] = [];
    proto.query = function (this: unknown, config: unknown, ...reste: unknown[]) {
      vues.push(typeof config === "string" ? config : String((config as { text?: string })?.text ?? ""));
      return original.call(this, config, ...reste);
    };
    try {
      await fn();
    } finally {
      proto.query = original;
    }
    return vues;
  }

  it("le chemin historique fait plus de 15 allers-retours sous le verrou ; le nouveau, UN", async () => {
    await nettoyer();
    // Caches chauds (colonnes, présence, configuration) : le régime établi.
    await traces(lotRiche(APP, "s-v109-chauffe-h", null))("historique");
    await traces(lotRiche(APP, "s-v109-chauffe-u", null))("un_ar");
    const historique = await requetesDe(() => traces(lotRiche(APP, "s-v109-ar-h", null))("historique"));
    const unAR = await requetesDe(() => traces(lotRiche(APP, "s-v109-ar-u", null))("un_ar"));
    const debut = historique.findIndex((q) => q === "begin");
    const verrou = historique.findIndex((q) => q.includes("pg_advisory_xact_lock"));
    const fin = historique.lastIndexOf("commit");
    expect(debut).toBeGreaterThanOrEqual(0);
    expect(fin - verrou).toBeGreaterThanOrEqual(15);
    expect(unAR).toHaveLength(1);
    expect(unAR[0]).toContain("mip_ingerer_lot_v1");
    console.info(`[v109] allers-retours d'un lot : historique ${historique.length} (dont ${fin - verrou} sous le verrou), un_ar ${unAR.length}`);
  });

  async function quelquUnAttend(): Promise<boolean> {
    const { rows } = await pool.query(
      "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and not granted",
      [VERROU_INGESTION_NS],
    );
    return Number(rows[0].n) > 0;
  }

  async function attendre(predicat: () => Promise<boolean>, quoi: string) {
    const fin = Date.now() + 15_000;
    for (;;) {
      if (await predicat()) return;
      if (Date.now() > fin) throw new Error(`condition jamais atteinte : ${quoi}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it("l'effacement tient le verrou : l'écriture attend, puis voit la barrière et REJETTE le sujet", async () => {
    await nettoyer();
    const effacement = await pool.connect();
    try {
      await effacement.query("begin");
      await effacement.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, APP]);
      await effacement.query(
        "insert into privacy_erasure_barrier (app_id, subject_kind, subject_key) values ($1, 'user', $2)",
        [APP, hashIdentity(SECRET, APP, "user", ALICE)],
      );
      const ecriture = writeRows(pool, fusion(lotRiche(APP, "s-v109-att-alice", ALICE), lotRiche(APP, "s-v109-att-bob", BOB)), { chemin: "un_ar", symbolicateur: null });
      await attendre(quelquUnAttend, "l'écriture attend le verrou de l'effacement");
      await effacement.query("commit");
      const bilan = await ecriture;
      expect(bilan.refuses?.sessions).toBe(1);
      const { rows } = await pool.query("select session_id from rum_session where app_id = $1 order by 1", [APP]);
      expect(rows.map((r: Ligne) => r.session_id)).toEqual(["s-v109-att-bob"]);
      const { rows: erreurs } = await pool.query("select count(*)::int as n from rum_error where app_id = $1 and session_id = 's-v109-att-alice'", [APP]);
      expect(erreurs[0].n).toBe(0);
    } finally {
      await effacement.query("rollback").catch(() => {});
      effacement.release();
    }
  });

  it("verrou indisponible : erreur identifiée et rejouable, rien d'écrit", async () => {
    await nettoyer();
    const tenant = await pool.connect();
    try {
      await tenant.query("begin");
      await tenant.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, APP]);
      await expect(writeRows(pool, lotRiche(APP, "s-v109-occupe", null), {
        chemin: "un_ar", symbolicateur: null, verrou: { delaiVerrouMs: 50, tentatives: 2 },
      })).rejects.toMatchObject({ name: "ErreurVerrouIngestion", reessayable: true });
      await expect(writeReplayChunk(pool, chunk(APP, "s-v109-occupe", 1), {
        chemin: "un_ar", verrou: { delaiVerrouMs: 50, tentatives: 1 },
      })).rejects.toMatchObject({ name: "ErreurVerrouIngestion" });
    } finally {
      await tenant.query("rollback");
      tenant.release();
    }
    const { rows } = await pool.query("select count(*)::int as n from rum_session where app_id = $1", [APP]);
    expect(rows[0].n).toBe(0);
  });

  it("échéance (P2) sous un verrou tenu : refus rejouable, rien d'écrit, connexion saine", async () => {
    await nettoyer();
    const tenant = await pool.connect();
    try {
      await tenant.query("begin");
      await tenant.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, APP]);
      const err = await writeRows(pool, lotRiche(APP, "s-v109-echeance", null), {
        chemin: "un_ar", symbolicateur: null, verrou: { delaiVerrouMs: 1_500, tentatives: 2, echeance: Date.now() + 300 },
      }).catch((e: unknown) => e as Error & { reessayable?: boolean });
      expect(["ErreurEcheance", "ErreurVerrouIngestion"]).toContain((err as Error).name);
      expect((err as { reessayable?: boolean }).reessayable).toBe(true);
    } finally {
      await tenant.query("rollback");
      tenant.release();
    }
    const { rows } = await pool.query("select count(*)::int as n from rum_session where app_id = $1", [APP]);
    expect(rows[0].n).toBe(0);
  });

  it("le drapeau : absent ou à 0, chemin historique ; à 100, un aller-retour ; illisible, historique", async () => {
    _resetUnAR(pool);
    await pool.query("update platform_flag set value = '0' where key = 'ingest_un_aller_retour_pct'");
    expect(await choisirChemin(pool)).toBe("historique");
    _resetUnAR(pool);
    await pool.query("update platform_flag set value = '100' where key = 'ingest_un_aller_retour_pct'");
    expect(await choisirChemin(pool)).toBe("un_ar");
    _resetUnAR(pool);
    await pool.query("update platform_flag set value = '30' where key = 'ingest_un_aller_retour_pct'");
    expect(await choisirChemin(pool, { tirage: () => 0.29 })).toBe("un_ar");
    expect(await choisirChemin(pool, { tirage: () => 0.3 })).toBe("historique");
    await expect(pool.query("update platform_flag set value = '30%' where key = 'ingest_un_aller_retour_pct'")).rejects.toThrow();
    await pool.query("update platform_flag set value = '0' where key = 'ingest_un_aller_retour_pct'");
    _resetUnAR(pool);
  });
});
