// P8.1 — l'effacement sérialisé avec l'ingestion, sur un VRAI PostgreSQL.
//
// CE QUI NE SE PROUVE PAS EN RELISANT LE CODE. Une course ne se démontre pas par
// un test à un seul acteur : il faut deux ou trois connexions réelles, et il
// faut décider QUI tient quoi et QUAND. Ce fichier joue les dix interleavings de
// la spécification, chacun avec des connexions distinctes.
//
// AUCUN `sleep` PROBABILISTE. Attendre « assez longtemps » produit un test qui
// passe sur une machine et échoue sur une autre, puis qu'on finit par ignorer.
// Ici l'attente porte sur une CONDITION lue en base — `pg_locks` dit qui attend
// un verrou consultatif de notre espace de noms —, et elle échoue franchement au
// bout de quinze secondes. Le point de reprise d'une transaction et le commit
// d'une autre sont déclenchés par le test, pas espérés.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { deposerLot, drainerIngestRaw } from "../../packages/backend/lib/ingest-differe.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetColonnesCache, writeLogs, writeReplayChunk, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import {
  ErreurVerrouIngestion,
  VERROU_INGESTION_NS,
  _resetPresenceBarrieres,
  withAppIngestTransaction,
  // @ts-expect-error module JS sans déclarations
} from "../../packages/backend/lib/privacy-barriere.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import { DSAR_ANCHOR, DSAR_CHILD_TABLES } from "../../apps/console/lib/dsar";
import { dsarIdentityCounts, dsarIdentityErase, type IdentityDsarIo } from "../../apps/console/lib/queries-dsar";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 8 } : { max: 8 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP = "p81-course";
const AUTRE = "p81-course-autre";
const SECRET = "test-only-identity-secret";
const ALICE = "alice@p81.test";
const BOB = "bob@p81.test";
const muet = { info() {}, warn() {}, error() {}, debug() {} };

const hashDe = (app: string, raw: string): string => hashIdentity(SECRET, app, "user", raw);

function attributs(valeurs: Record<string, string | number>) {
  return Object.entries(valeurs).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
  }));
}

let compteurSpan = 0;
const spanId = () => (0x7810_0000_0000_0000n + BigInt(++compteurSpan)).toString(16);

/**
 * Un lot aplati produit par le VRAI parser, identités sécurisées comme au port
 * d'ingestion : un lot écrit à la main ne prouverait rien du produit.
 */
function lot(app: string, session: string, raw: string | null, { vital = false } = {}) {
  const ns = BigInt(Date.now()) * 1_000_000n;
  const span = (nom: string, extra: Record<string, string | number>) => ({
    name: nom,
    traceId: "b".repeat(32),
    spanId: spanId(),
    startTimeUnixNano: ns.toString(),
    endTimeUnixNano: (ns + 5_000_000n).toString(),
    attributes: attributs({
      "mip.session_id": session,
      "mip.route": "/panier",
      ...(raw ? { "mip.identity.user_id": raw } : {}),
      ...extra,
    }),
  });
  const spans = [
    span("pageview", {
      "mip.visitor_id": `v-${session}`,
      "mip.url": "https://p81.test/panier",
      "mip.nav_type": "navigate",
      "mip.device_type": "desktop",
    }),
  ];
  if (vital) {
    spans.push(span("webvital.LCP", {
      "webvital.name": "LCP", "webvital.value": 1234, "webvital.rating": "good",
      "webvital.id": `${session}-lcp`,
    }));
  }
  return flattenOtlp(secureOtlpIdentities({
    resourceSpans: [{
      resource: { attributes: attributs({ "mip.app_id": app, "mip.client_id": "p81" }) },
      scopeSpans: [{ spans }],
    }],
  }, SECRET).payload);
}

/** Deux personnes dans UN SEUL lot — le cas qui interdit de tout supprimer. */
function lotMixte(app: string) {
  const a = lot(app, "p81-mix-alice", ALICE);
  const b = lot(app, "p81-mix-bob", BOB);
  const fusion: Record<string, unknown[]> = {};
  for (const cle of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ga = (a as Record<string, unknown>)[cle];
    const gb = (b as Record<string, unknown>)[cle];
    fusion[cle] = Array.isArray(ga) && Array.isArray(gb) ? [...ga, ...gb] : (ga ?? gb) as unknown[];
  }
  return fusion;
}

/**
 * Couture DSAR branchée sur la BASE JETABLE de ce test.
 *
 * Sans elle, les fonctions de la console retomberaient sur `lib/db`, donc sur
 * `DATABASE_URL` : le test passerait en n'effaçant rien, ailleurs.
 */
const dsarIo: IdentityDsarIo = {
  query: async <T,>(text: string, params?: unknown[]) => (await pool.query(text, params)).rows as T[],
  transaction: async <T,>(fn: (c: pg.PoolClient) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
};

/** Couture DSAR branchée sur une connexion PRÉCISE : le test sait qui tient quoi. */
function ioSur(client: pg.PoolClient): IdentityDsarIo {
  return {
    query: async <T,>(text: string, params?: unknown[]) => (await client.query(text, params)).rows as T[],
    transaction: async <T,>(fn: (c: pg.PoolClient) => Promise<T>) => {
      await client.query("begin");
      try {
        const out = await fn(client);
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
    },
  };
}

/**
 * Même couture, mais le COMMIT attend un signal du test : c'est ainsi qu'on fait
 * tenir le verrou à l'effacement pendant qu'un writer s'y heurte, sans supposer
 * une durée.
 */
function ioRetenu(client: pg.PoolClient) {
  let liberer: () => void = () => {};
  const signal = new Promise<void>((r) => { liberer = r; });
  const io: IdentityDsarIo = {
    query: async <T,>(text: string, params?: unknown[]) => (await client.query(text, params)).rows as T[],
    transaction: async <T,>(fn: (c: pg.PoolClient) => Promise<T>) => {
      await client.query("begin");
      try {
        const out = await fn(client);
        await signal;
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
    },
  };
  return { io, commettre: () => liberer() };
}

/** Attente sur CONDITION, jamais sur durée. Échoue franchement si elle n'arrive pas. */
async function attendre(predicat: () => Promise<boolean>, quoi: string, limiteMs = 15_000): Promise<void> {
  const fin = Date.now() + limiteMs;
  for (;;) {
    if (await predicat()) return;
    if (Date.now() > fin) throw new Error(`condition jamais atteinte : ${quoi}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Quelqu'un attend-il un verrou d'ingestion ? C'est PostgreSQL qui le dit. */
async function quelquUnAttend(): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and not granted",
    [VERROU_INGESTION_NS],
  );
  return Number(rows[0].n) > 0;
}

const compter = async (table: string, app: string): Promise<number> => Number(
  (await pool.query(`select count(*)::int as n from ${table} where app_id = $1`, [app])).rows[0].n,
);

async function nettoyer() {
  for (const app of [APP, AUTRE]) {
    await pool.query("delete from ingest_raw where app_id = $1", [app]);
    for (const t of ["rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_log",
      "replay_chunk", "rum_event", "rum_span", "rum_breadcrumb", "rum_longtask", "rum_resource",
      "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${t} where app_id = $1`, [app]);
    }
    await pool.query("delete from privacy_erasure_barrier where app_id = $1", [app]);
    await pool.query("delete from privacy_erasure_request where app_id = $1", [app]);
    await pool.query("delete from analytics_rollup_invalidation where app_id = $1", [app]);
  }
}

beforeAll(async () => {
  if (!url) return;
  const fichiers = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const f of fichiers) await pool.query(readFileSync(join(SQL_DIR, f), "utf8"));
  for (const app of [APP, AUTRE]) {
    await pool.query(
      // ACTIVATION EXPLICITE. Le défaut est `off` : la protection durable n'est
      // pas déclarée active tant qu'un exploitant ne l'a pas posée. Les tests la
      // posent, parce que ce sont eux qui prouvent le protocole.
      `insert into app_registry (app_id, name, active, privacy_barrier_mode)
       values ($1, $1, true, 'enforce')
       on conflict (app_id) do update set active = true, privacy_barrier_mode = 'enforce'`,
      [app],
    );
  }
  await nettoyer();
}, 300_000);

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from app_registry where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.end();
});

beforeEach(async () => {
  if (!url) return;
  _resetPresenceBarrieres();
  await nettoyer();
});

suite("P8.1 — les dix interleavings de l'effacement et de l'ingestion", () => {
  it("1. le writer tient le verrou, l'effacement attend : il commit, puis il ne reste rien du ciblé", async () => {
    const hash = hashDe(APP, ALICE);
    const writer = await pool.connect();
    const dsar = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, APP]);
      await writeRows(pool, lot(APP, "p81-w1", ALICE), { client: writer });

      // L'effacement démarre et se heurte au verrou : c'est PostgreSQL qui le dit.
      const efface = dsarIdentityErase(APP, "user", hash, ioSur(dsar));
      await attendre(quelquUnAttend, "l'effacement attend le verrou du writer");
      // La ligne écrite n'est pas encore visible : la transaction du writer tient.
      expect(await compter("rum_session", APP)).toBe(0);

      await writer.query("commit");
      const bilan = await efface;

      expect(bilan.find((b) => b.table === "rum_session")?.deleted).toBe(1);
      expect(await compter("rum_session", APP)).toBe(0);
      expect(await compter("rum_pageview", APP)).toBe(0);
      const { rows } = await pool.query(
        "select subject_kind, subject_key from privacy_erasure_barrier where app_id = $1 order by 1",
        [APP],
      );
      expect(rows).toEqual([
        { subject_kind: "session", subject_key: "p81-w1" },
        { subject_kind: "user", subject_key: hash },
      ]);
    } finally {
      writer.release();
      dsar.release();
    }
  });

  it("2. l'effacement tient le verrou, le writer attend : après le commit il voit la barrière et REJETTE le ciblé", async () => {
    const hash = hashDe(APP, ALICE);
    await writeRows(pool, lot(APP, "p81-w2", ALICE));
    const dsar = await pool.connect();
    try {
      const { io, commettre } = ioRetenu(dsar);
      const efface = dsarIdentityErase(APP, "user", hash, io);
      await attendre(
        async () => (await pool.query(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and granted",
          [VERROU_INGESTION_NS],
        )).rows[0].n > 0,
        "l'effacement tient le verrou",
      );

      // Le writer arrive avec DEUX personnes : la ciblée et une autre.
      const ecriture = writeRows(pool, lotMixte(APP));
      await attendre(quelquUnAttend, "le writer attend le verrou de l'effacement");

      commettre();
      await efface;
      const bilan = await ecriture;

      // Le lot n'est pas perdu : seule la personne effacée l'est.
      expect(bilan.refuses).toBeTruthy();
      const sessions = (await pool.query<{ session_id: string }>(
        "select session_id from rum_session where app_id = $1 order by 1", [APP],
      )).rows.map((r) => r.session_id);
      expect(sessions).toEqual(["p81-mix-bob"]);
    } finally {
      dsar.release();
    }
  });

  it("3. un lot ciblé DÉPOSÉ APRÈS l'effacement n'entre pas en file, et le drain ne recrée rien", async () => {
    const hash = hashDe(APP, ALICE);
    await writeRows(pool, lot(APP, "p81-w3", ALICE));
    await dsarIdentityErase(APP, "user", hash, dsarIo);
    expect(await compter("rum_session", APP)).toBe(0);

    // Le lot arrive APRÈS le snapshot : c'est exactement ce qui échappait.
    const depot = await deposerLot(pool, APP, lot(APP, "p81-w3", ALICE));
    expect(depot).toEqual({ deposes: 0, refuses: expect.any(Number) });
    expect(depot.refuses).toBeGreaterThan(0);
    expect(await compter("ingest_raw", APP)).toBe(0);
    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 0, echecs: 0 });
    expect(await compter("rum_session", APP)).toBe(0);

    // Et l'écriture synchrone du même lot est refusée de la même façon.
    await writeRows(pool, lot(APP, "p81-w3", ALICE));
    expect(await compter("rum_session", APP)).toBe(0);
  });

  it("4. aucune session écrite, la personne n'est connue que d'un lot EN FILE : la barrière d'identité suffit", async () => {
    const hash = hashDe(APP, ALICE);
    await deposerLot(pool, APP, lot(APP, "p81-w4", ALICE));
    expect(await compter("ingest_raw", APP)).toBe(1);
    expect(await compter("rum_session", APP)).toBe(0);

    const bilan = await dsarIdentityErase(APP, "user", hash, dsarIo);
    // Rien à supprimer dans les sources : tout était en file.
    expect(bilan.find((b) => b.table === "rum_session")?.deleted).toBe(0);
    expect(await compter("ingest_raw", APP)).toBe(0);

    const barrieres = (await pool.query<{ subject_kind: string; subject_key: string }>(
      "select subject_kind, subject_key from privacy_erasure_barrier where app_id = $1 order by 1", [APP],
    )).rows;
    // La session n'existait dans AUCUNE table : elle a été trouvée dans le lot.
    expect(barrieres).toEqual([
      { subject_kind: "session", subject_key: "p81-w4" },
      { subject_kind: "user", subject_key: hash },
    ]);
    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 0, echecs: 0 });
    expect(await compter("rum_session", APP)).toBe(0);
  });

  it("5. un rejeu ou un log arrivé APRÈS l'effacement : même barrière, aucune session minimale recréée", async () => {
    const hash = hashDe(APP, ALICE);
    await writeRows(pool, lot(APP, "p81-w5", ALICE));
    await dsarIdentityErase(APP, "user", hash, dsarIo);

    // Rejeu : refus DÉFINITIF, et surtout aucune ligne rum_session inventée pour
    // satisfaire la clé étrangère — c'était le contournement.
    const rejeu = await writeReplayChunk(pool, {
      sessionId: "p81-w5", appId: APP, seq: 0,
      body: gzipSync(Buffer.from("[]", "utf8")), eventsCount: 0,
    });
    expect(rejeu).toEqual({ etat: "refus_barriere" });
    expect(await compter("rum_session", APP)).toBe(0);
    expect(await compter("replay_chunk", APP)).toBe(0);

    // Rejeu d'une session JAMAIS vue, protection active : refus TEMPORAIRE borné,
    // corps non persisté. Le SDK renverra après l'ancre OTLP.
    const jamaisVue = await writeReplayChunk(pool, {
      sessionId: "p81-w5-neuve", appId: APP, seq: 0,
      body: gzipSync(Buffer.from("[]", "utf8")), eventsCount: 0,
    });
    expect(jamaisVue.etat).toBe("attente_session");
    expect(jamaisVue.retryAfterS).toBeGreaterThan(0);
    expect(await compter("replay_chunk", APP)).toBe(0);
    expect(await compter("rum_session", APP)).toBe(0);

    // Log OTel portant la session effacée, et exception portant le HMAC : les deux
    // passent par la même barrière que les traces.
    const ecrit = await writeLogs(
      pool,
      [{ app_id: APP, ts: new Date(), severity_num: 17, severity_text: "ERROR", body: "boom",
         source: "otel", trace_id: null, span_id: null, session_id: "p81-w5", route: "/panier", attributes: null }],
      [],
    );
    expect(ecrit.logs).toBe(0);
    expect(await compter("rum_log", APP)).toBe(0);
  });

  it("6. un lot MIXTE : la personne qui a demandé part, l'autre reste — le lot n'est pas supprimé en bloc", async () => {
    const hashAlice = hashDe(APP, ALICE);
    await deposerLot(pool, APP, lotMixte(APP));
    expect(await compter("ingest_raw", APP)).toBe(1);

    await dsarIdentityErase(APP, "user", hashAlice, dsarIo);
    // La ligne de file SURVIT, amputée : supprimer le lot entier effacerait les
    // données de quelqu'un qui n'a rien demandé.
    expect(await compter("ingest_raw", APP)).toBe(1);
    const { rows: [restant] } = await pool.query<{ sessions: number }>(
      `select jsonb_array_length(lot -> 'sessions') as sessions from ingest_raw where app_id = $1`, [APP],
    );
    expect(Number(restant.sessions)).toBe(1);

    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 1, echecs: 0 });
    const sessions = (await pool.query<{ session_id: string }>(
      "select session_id from rum_session where app_id = $1 order by 1", [APP],
    )).rows.map((r) => r.session_id);
    expect(sessions).toEqual(["p81-mix-bob"]);
    expect(await dsarIdentityCounts(APP, "user", hashDe(APP, BOB), dsarIo)).toContainEqual({ table: "rum_session", rows: 1 });
  });

  it("7. double effacement + travailleur + rematérialisation : aucun interblocage, résultat idempotent", async () => {
    const hash = hashDe(APP, ALICE);
    await writeRows(pool, lot(APP, "p81-w7", ALICE, { vital: true }));
    await deposerLot(pool, APP, lot(APP, "p81-w7-file", ALICE));

    // Quatre acteurs, quatre connexions, lancés ensemble. Un ordre de verrous
    // incohérent se manifesterait ici par un 40P01 ou par un blocage définitif.
    const resultats = await Promise.allSettled([
      dsarIdentityErase(APP, "user", hash, dsarIo),
      dsarIdentityErase(APP, "user", hash, dsarIo),
      drainerIngestRaw(pool, { max: 10, log: muet }),
      pool.query("select refresh_metric_histogram(26)"),
    ]);
    for (const r of resultats) {
      if (r.status === "rejected") throw r.reason;
    }
    expect(await compter("rum_session", APP)).toBe(0);
    expect(await compter("rum_metric", APP)).toBe(0);
    expect(await compter("ingest_raw", APP)).toBe(0);

    // Rejouer l'effacement est sans effet : il est idempotent.
    const rejeu = await dsarIdentityErase(APP, "user", hash, dsarIo);
    expect(rejeu.every((b) => b.deleted === 0)).toBe(true);
    const { rows } = await pool.query<{ n: string }>(
      "select count(*)::int as n from privacy_erasure_barrier where app_id = $1 and subject_kind = 'user'", [APP],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("8. panne APRÈS l'écriture et AVANT le retrait du lot : tout est annulé, la reprise n'écrit pas deux fois", async () => {
    await deposerLot(pool, APP, lot(APP, "p81-w8", ALICE));
    const client = await pool.connect();
    try {
      // Reproduction exacte du drain, interrompue entre l'écriture et le retrait.
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, APP]);
      const { rows } = await client.query<{ id: string; lot: Record<string, unknown[]> }>(
        "select id, lot from ingest_raw where app_id = $1 for update skip locked", [APP],
      );
      await writeRows(pool, rows[0].lot, { client });
      // « Crash » : la transaction entière disparaît, écriture comprise.
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(await compter("rum_session", APP)).toBe(0);
    expect(await compter("ingest_raw", APP)).toBe(1);

    expect(await drainerIngestRaw(pool, { max: 10, log: muet })).toEqual({ drains: 1, echecs: 0 });
    expect(await compter("rum_session", APP)).toBe(1);
    expect(await compter("rum_pageview", APP)).toBe(1);
    expect(await compter("ingest_raw", APP)).toBe(0);
  });

  it("9. une rematérialisation pendant l'effacement attend le MÊME verrou : ni résurrection, ni compteur périmé", async () => {
    const hash = hashDe(APP, ALICE);
    await writeRows(pool, lot(APP, "p81-w9", ALICE, { vital: true }));
    await pool.query("select refresh_metric_histogram(26)");
    const avant = Number((await pool.query<{ n: string }>(
      "select coalesce(sum(observed_count), 0)::int as n from metric_histogram_hourly where app_id = $1", [APP],
    )).rows[0].n);
    expect(avant).toBeGreaterThan(0);

    const dsar = await pool.connect();
    try {
      const { io, commettre } = ioRetenu(dsar);
      const efface = dsarIdentityErase(APP, "user", hash, io);
      await attendre(
        async () => (await pool.query(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and granted", [VERROU_INGESTION_NS],
        )).rows[0].n > 0,
        "l'effacement tient le verrou",
      );
      const rafraichi = pool.query("select refresh_metric_histogram(26)");
      await attendre(quelquUnAttend, "la rematérialisation attend le verrou de l'effacement");
      commettre();
      await efface;
      await rafraichi;
    } finally {
      dsar.release();
    }

    // La cellule a été recalculée SANS les mesures effacées, et la marque
    // d'invalidation posée par l'effacement a été levée par le recalcul.
    const apres = Number((await pool.query<{ n: string }>(
      "select coalesce(sum(observed_count), 0)::int as n from metric_histogram_hourly where app_id = $1", [APP],
    )).rows[0].n);
    expect(apres).toBe(0);
    // Chaque projection lève SA marque : celle de la heatmap survit tant que son
    // propre rafraîchissement n'est pas passé — lent, jamais faux.
    const restantes = (await pool.query<{ source: string }>(
      "select source from analytics_rollup_invalidation where app_id = $1 order by 1", [APP],
    )).rows.map((r) => r.source);
    expect(restantes).toEqual(["rum_rollup_hourly"]);
    await pool.query("select refresh_rum_rollups(26)");
    const marques = Number((await pool.query<{ n: string }>(
      "select count(*)::int as n from analytics_rollup_invalidation where app_id = $1", [APP],
    )).rows[0].n);
    expect(marques).toBe(0);
  });

  it("10. la même empreinte dans une AUTRE application est conservée, et invisible au rapport", async () => {
    const hashIci = hashDe(APP, ALICE);
    await writeRows(pool, lot(APP, "p81-w10", ALICE));
    // Le HMAC est cloisonné par app : le MÊME identifiant brut n'y produit pas la
    // même empreinte. On force donc la valeur d'ici dans l'autre application —
    // le pire cas, une collision — pour prouver que la barrière ne franchit pas
    // la frontière.
    await pool.query(
      "insert into rum_session (session_id, app_id, user_id_hash) values ($1, $2, $3)",
      ["p81-w10-autre", AUTRE, hashIci],
    );

    expect(await dsarIdentityCounts(APP, "user", hashIci, dsarIo)).toContainEqual({ table: "rum_session", rows: 1 });
    await dsarIdentityErase(APP, "user", hashIci, dsarIo);

    expect(await compter("rum_session", APP)).toBe(0);
    expect(await compter("rum_session", AUTRE)).toBe(1);
    // Le rapport de l'autre app ne voit ni la barrière, ni la demande d'ici.
    expect(Number((await pool.query<{ n: string }>(
      "select count(*)::int as n from privacy_erasure_barrier where app_id = $1", [AUTRE],
    )).rows[0].n)).toBe(0);
    // Et l'ingestion de l'autre application n'est pas bloquée.
    await writeRows(pool, lot(AUTRE, "p81-w10-autre-2", ALICE));
    expect(await compter("rum_session", AUTRE)).toBe(2);
    // Enfin, le même identifiant brut ne produit pas la même empreinte des deux côtés.
    expect(hashDe(AUTRE, ALICE)).not.toBe(hashIci);
  });
});

suite("P8.1 — l'inventaire des tables ne se recopie pas à la main", () => {
  /**
   * Toute table portant `session_id` appartient au périmètre DSAR, ou figure
   * dans une liste d'exclusions JUSTIFIÉE. Une table ajoutée par un lot ultérieur
   * et oubliée fait échouer CE test, pas un audit six mois plus tard — c'est
   * exactement ainsi que `rum_log` (P5.3) est resté hors du périmètre.
   */
  it("toute table portant session_id est couverte par DSAR_CHILD_TABLES", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
        join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
       where c.table_schema = 'public' and c.column_name = 'session_id'
       order by 1`,
    );
    // `rum_session` est l'ANCRE, pas une table enfant.
    const attendues = rows.map((r) => r.table_name).filter((t) => t !== DSAR_ANCHOR);
    expect([...DSAR_CHILD_TABLES].sort()).toEqual(attendues.sort());
  });

  /**
   * Même principe pour l'effacement d'un client : chaque table app-scopée est
   * soit vidée, soit nommée dans une exclusion motivée (cf. le commentaire de
   * fin de `erase_app_data` dans migration-v81).
   */
  it("toute table app-scopée est vidée par erase_app_data, ou explicitement conservée", async () => {
    const CONSERVEES = [
      // Le refus opposé à une résurrection, et son journal.
      "privacy_erasure_barrier", "privacy_erasure_request",
      // Porte la suspension d'ingestion : la supprimer rouvrirait l'app.
      "app_registry",
      // Facturation et compteurs de débit, pas de la télémétrie.
      "tenant_usage_daily", "rate_counter",
      // Supprimées en CASCADE avec leur parent.
      "error_issue_activity", "error_issue_alias", "error_issue_ticket", "error_issue_notification",
      // P8.6 : file de sortie et journal des livraisons entrantes d'un connecteur
      // de tickets, emportés en cascade avec `ticket_integration` (que
      // `erase_app_data` supprime, lui, directement).
      "ticket_outbox", "ticket_webhook_event",
      // Configuration d'exploitation — écart assumé, consigné dans v81.
      "slo", "goal", "notify_channel", "uptime_check", "read_tokens", "deploy_marker",
      "ai_briefing", "extension_scope", "extension_install_app",
      // v90 : le journal d'audit porte `app_id`, et il est en AJOUT SEUL — il garde
      // la trace de l'effacement lui-même.
      "audit_log",
    ];
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
        join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
       where c.table_schema = 'public' and c.column_name = 'app_id'
         and not exists (select 1 from pg_proc p
                          where p.proname = 'erase_app_data'
                            and p.prosrc like '%from ' || c.table_name || ' %')
       order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...CONSERVEES].sort());
  });

  it("l'effacement d'une app SUSPEND son ingestion, et la reprise est explicite", async () => {
    await writeRows(pool, lot(AUTRE, "p81-suspension", ALICE));
    await pool.query("select erase_app_data($1)", [AUTRE]);
    const { rows } = await pool.query<{ active: boolean; suspendue: Date | null; par: string | null }>(
      "select active, ingestion_suspended_at as suspendue, ingestion_suspended_by as par from app_registry where app_id = $1",
      [AUTRE],
    );
    expect(rows[0].active).toBe(false);
    expect(rows[0].suspendue).not.toBeNull();
    expect(rows[0].par).toBe("erase_app_data");
    expect(await compter("rum_session", AUTRE)).toBe(0);

    // Un événement reçu ensuite ne relève PAS la suspension : le registre la
    // porte, et seule une opération d'exploitation l'efface.
    const { rows: apres } = await pool.query<{ active: boolean }>(
      "select active from app_registry where app_id = $1", [AUTRE],
    );
    expect(apres[0].active).toBe(false);
    await pool.query(
      "update app_registry set active = true, ingestion_suspended_at = null, ingestion_suspended_by = null where app_id = $1",
      [AUTRE],
    );
  });
});

// ═══════════════════════ Fenêtre de déploiement v80 → v81 ════════════════════
//
// Le code part en production AVANT que le pré-déploiement n'applique v81. Rien
// de ce qui précède ne doit alors échouer : sans la table de barrières, le
// produit se comporte exactement comme avant — sérialisation comprise, puisque
// le verrou consultatif ne dépend d'aucune migration.
const urlPreV81 = process.env.SQL_TEST_PRE_V81_DATABASE_URL;
const suiteFenetre = urlPreV81 ? describe : describe.skip;
const poolFenetre = new pg.Pool(urlPreV81 ? { connectionString: urlPreV81, max: 4 } : { max: 4 });

suiteFenetre("P8.1 — code publié AVANT migration-v81", () => {
  const ioFenetre: IdentityDsarIo = {
    query: async <T,>(text: string, params?: unknown[]) => (await poolFenetre.query(text, params)).rows as T[],
    transaction: async <T,>(fn: (c: pg.PoolClient) => Promise<T>) => {
      const client = await poolFenetre.connect();
      try {
        await client.query("begin");
        const out = await fn(client);
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };

  beforeAll(async () => {
    if (!urlPreV81) return;
    await poolFenetre.query("drop schema public cascade; create schema public;");
    const fichiers = readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= 80)
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    await poolFenetre.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
    for (const f of fichiers) await poolFenetre.query(readFileSync(join(SQL_DIR, f), "utf8"));
    await poolFenetre.query(
      "insert into app_registry (app_id, name, active) values ($1,$1,true) on conflict (app_id) do update set active = true",
      [APP],
    );
    _resetPresenceBarrieres();
    // Le cache de colonnes de `pg-ingest` est indexé par TABLE, pas par base, et
    // il vit 60 s. Cette suite écrit dans une SECONDE base, au schéma plus
    // ancien, depuis le même processus : sans cette remise à zéro, l'INSERT
    // reprend la liste de colonnes relevée sur la base complète et cite une
    // colonne que celle-ci n'a pas encore — ce qui fait rejeter le lot ENTIER.
    // C'est le garde-fou de déploiement progressif qui se retourne contre
    // lui-même, faute d'être rejoué au changement de base. Révélé par la colonne
    // `runtime` de v82, la première ajoutée depuis l'écriture de cette suite.
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    if (!urlPreV81) return;
    // Symétrique : ne pas laisser au fichier suivant une liste de colonnes
    // relevée sur un schéma tronqué, où l'oubli serait SILENCIEUX.
    _resetColonnesCache();
    await poolFenetre.end();
  });

  it("écriture, dépôt, drain et effacement fonctionnent sans la table de barrières", async () => {
    await writeRows(poolFenetre, lot(APP, "p81-fenetre-1", ALICE));
    await deposerLot(poolFenetre, APP, lot(APP, "p81-fenetre-2", ALICE));
    expect(await drainerIngestRaw(poolFenetre, { max: 10, log: muet })).toEqual({ drains: 1, echecs: 0 });

    const bilan = await dsarIdentityErase(APP, "user", hashDe(APP, ALICE), ioFenetre);
    expect(bilan.find((b) => b.table === "rum_session")?.deleted).toBe(2);
    expect(Number((await poolFenetre.query<{ n: string }>(
      "select count(*)::int as n from rum_session where app_id = $1", [APP],
    )).rows[0].n)).toBe(0);
    // Aucune barrière : la table n'existe pas encore, et c'est l'état ANTÉRIEUR,
    // pas une régression. La protection durable n'est simplement pas disponible.
    expect(Number((await poolFenetre.query<{ n: string }>(
      "select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = 'privacy_erasure_barrier'",
    )).rows[0].n)).toBe(0);
  });

  it("v81 appliquée ensuite : le protocole devient disponible, et l'activation reste explicite", async () => {
    await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v81.sql"), "utf8"));
    _resetPresenceBarrieres();
    // Défaut `off` : la protection durable n'est PAS activée par la migration.
    expect((await poolFenetre.query<{ mode: string }>(
      "select privacy_barrier_mode as mode from app_registry where app_id = $1", [APP],
    )).rows[0].mode).toBe("off");

    await writeRows(poolFenetre, lot(APP, "p81-fenetre-3", ALICE));
    await dsarIdentityErase(APP, "user", hashDe(APP, ALICE), ioFenetre);
    // Sous `off`, rien n'est conservé de la personne effacée : une barrière est
    // elle-même un identifiant pseudonyme.
    expect(Number((await poolFenetre.query<{ n: string }>(
      "select count(*)::int as n from privacy_erasure_barrier where app_id = $1", [APP],
    )).rows[0].n)).toBe(0);

    // Activation explicite, puis la barrière est posée.
    await poolFenetre.query("update app_registry set privacy_barrier_mode = 'enforce' where app_id = $1", [APP]);
    _resetPresenceBarrieres();
    await writeRows(poolFenetre, lot(APP, "p81-fenetre-4", ALICE));
    await dsarIdentityErase(APP, "user", hashDe(APP, ALICE), ioFenetre);
    expect(Number((await poolFenetre.query<{ n: string }>(
      "select count(*)::int as n from privacy_erasure_barrier where app_id = $1", [APP],
    )).rows[0].n)).toBeGreaterThan(0);
    await writeRows(poolFenetre, lot(APP, "p81-fenetre-4", ALICE));
    expect(Number((await poolFenetre.query<{ n: string }>(
      "select count(*)::int as n from rum_session where app_id = $1", [APP],
    )).rows[0].n)).toBe(0);
  });
});

suite("P8.1 — la stratégie d'attente est bornée et NOMMÉE", () => {
  it("le verrou indisponible rend une erreur identifiée et rejouable, jamais un succès", async () => {
    const tenant = await pool.connect();
    try {
      await tenant.query("begin");
      await tenant.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, APP]);
      // Borne courte explicite : le test prouve le MÉCANISME, pas la valeur de
      // production (5 s, trois tentatives — cf. STRATEGIE_VERROU).
      const depart = Date.now();
      await expect(
        withAppIngestTransaction(pool, APP, async () => "jamais", { delaiVerrouMs: 120, tentatives: 2 }),
      ).rejects.toBeInstanceOf(ErreurVerrouIngestion);
      // Bornée : deux tentatives de 120 ms plus le recul, très loin d'une attente
      // indéfinie.
      expect(Date.now() - depart).toBeLessThan(5_000);
      await tenant.query("rollback");
    } finally {
      tenant.release();
    }
  });

  it("une session déjà enregistrée sous une autre application n'est pas mise à jour par la voisine", async () => {
    await writeRows(pool, lot(APP, "p81-scope", ALICE));
    const avant = (await pool.query<{ last_seen_at: Date }>(
      "select last_seen_at from rum_session where session_id = $1", ["p81-scope"],
    )).rows[0].last_seen_at;

    // L'autre application revendique le MÊME identifiant de session.
    await expect(writeRows(pool, lot(AUTRE, "p81-scope", BOB))).rejects.toMatchObject({
      name: "ErreurPorteeApp",
    });
    const apres = await pool.query<{ app_id: string; last_seen_at: Date }>(
      "select app_id, last_seen_at from rum_session where session_id = $1", ["p81-scope"],
    );
    expect(apres.rows).toHaveLength(1);
    expect(apres.rows[0].app_id).toBe(APP);
    expect(apres.rows[0].last_seen_at).toEqual(avant);
  });
});
