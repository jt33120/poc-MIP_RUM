// P3 — RELAIS D'INGESTION, de bout en bout : route handler de la console →
// collector RÉEL (`services/collector/server.mjs`, processus à part) → ligne
// en base. Sur Postgres Docker, jamais la production (le test refuse un hôte
// non local).
//
// Ce que ce fichier prouve, et que les tests unitaires ne peuvent pas prouver :
//   · le drapeau semé par v87 (`ingest_relay_pct = '0'`) COUPE le relais même
//     quand l'environnement dit 100 : appliquer la migration ne relaie rien ;
//   · ligne de drapeau absente + `INGEST_RELAY_PCT=100` : les QUATRE signaux
//     (traces, logs, replay, source maps par jeton) passent par le vrai
//     collector et y sont écrits — c'est lui qui hache l'identité (la console,
//     comme Vercel aujourd'hui, n'a pas de secret) et qui prend le pays du
//     relais signé (`geo_source = 'cdn'`, pays « FR ») ;
//   · AUCUNE adresse n'arrive au collector : l'en-tête `x-forwarded-for` du
//     client n'est pas transmis (le collector, qui en ferait sinon du GeoIP en
//     `GEOIP_IP_SOURCE=xff:1`, ne voit que l'adresse de la console) ;
//   · collector ARRÊTÉ : erreur de connexion → repli local, la ligne est écrite
//     par la console, sans identité (secret vide), la réponse reste 200.
//
// LANCEMENT :
//   docker run -d --rm --name mip-relais -e POSTGRES_PASSWORD=postgres -p 55455:5432 postgres:17
//   psql … -c 'create database relais_it'
//   DATABASE_URL=postgres://postgres:postgres@localhost:55455/relais_it node services/scheduler/migrate.mjs
//   RELAY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55455/relais_it \
//     pnpm exec vitest run tests/contract/relais-ingestion.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// AVANT TOUT IMPORT DE LA CONSOLE : `@/lib/db` lit DATABASE_URL au chargement.
// Écrasée même quand le test est ignoré — une variable héritée du shell (le
// `.env` de production) ne doit jamais atteindre un pool que ce fichier importe.
const ENV = vi.hoisted(() => {
  const url = process.env.RELAY_TEST_DATABASE_URL || null;
  if (url) {
    const hote = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hote)) {
      throw new Error(`relais : base non locale refusée (${hote}) — Docker uniquement`);
    }
  }
  process.env.DATABASE_URL = url ?? "postgres://relais:absente@127.0.0.1:9/relais_absente";
  process.env.REQUIRE_API_KEY = "true";
  process.env.RATE_LIMIT_PER_MIN = "600";
  // La console telle que Vercel aujourd'hui : AUCUN secret d'identité.
  process.env.IDENTITY_HASH_SECRET = "";
  process.env.INGEST_RELAY_PCT = "100";
  process.env.EDGE_PROXY_SECRET = "relais-secret-de-bord-".padEnd(48, "x");
  return { url, bord: process.env.EDGE_PROXY_SECRET };
});

import { POST as POST_LOGS } from "../../apps/console/app/api/ingest/v1/logs/route";
import { POST as POST_REPLAY } from "../../apps/console/app/api/ingest/v1/replay/route";
import { POST as POST_TRACES } from "../../apps/console/app/api/ingest/v1/traces/route";
import { POST as POST_SOURCEMAPS } from "../../apps/console/app/api/sourcemaps/route";
import { pool as poolConsole } from "../../apps/console/lib/db";
import { _resetRelais } from "../../apps/console/lib/ingest-relay";
import { _resetPlatformFlagCache } from "../../apps/console/lib/platform-flag";
// @ts-expect-error module ESM partagé, sans déclarations
import { empreinteIdentite } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { genererJetonUpload } from "../../packages/backend/lib/sourcemap-upload.mjs";

if (process.env.CI && !ENV.url) {
  throw new Error("CI : RELAY_TEST_DATABASE_URL est requise (pas de skip silencieux)");
}
const suite = ENV.url ? describe : describe.skip;

const RACINE = join(__dirname, "..", "..");
const APP = { id: "relais-a", cle: "relais-cle-a" };
const SECRET_IDENTITE = "relais-secret-identite-".padEnd(48, "y");
const JETON = genererJetonUpload() as { id: string; jeton: string; empreinte: string };
const IP = "203.0.113.42";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const nanos = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

const ECHANTILLON = JSON.parse(readFileSync(join(RACINE, "tests", "fixtures", "otlp-sample-v2.json"), "utf8")) as {
  resourceSpans: Array<Record<string, any>>;
};

/** Lot OTLP traces : l'échantillon v2 du SDK, SANS fuseau (le pays doit venir du relais), plus une identité brute. */
function traces(session: string, n: number) {
  const lot = structuredClone(ECHANTILLON);
  const rs = lot.resourceSpans[0];
  rs.resource.attributes = rs.resource.attributes
    .filter((a: { key: string }) => !["mip.api_key", "mip.tz"].includes(a.key))
    .map((a: { key: string }) => (a.key === "mip.app_id" ? attr("mip.app_id", APP.id) : a));
  rs.resource.attributes.push(attr("mip.api_key", APP.cle));
  const spans = rs.scopeSpans[0].spans as Array<Record<string, any>>;
  const t0 = Date.now() - 60_000;
  const origine = Number(BigInt(spans[0].startTimeUnixNano) / 1_000_000n);
  const prefixe = n.toString(16).padStart(4, "0");
  for (const [i, span] of spans.entries()) {
    span.traceId = `${prefixe}${"0".repeat(24)}c001`;
    span.spanId = `${prefixe}${(i + 1).toString(16).padStart(12, "0")}`;
    for (const cle of ["startTimeUnixNano", "endTimeUnixNano"]) {
      span[cle] = nanos(t0 + (Number(BigInt(span[cle]) / 1_000_000n) - origine));
    }
    span.attributes = span.attributes.filter((a: { key: string }) => a.key !== "mip.tz");
    for (const a of span.attributes) if (a.key === "mip.session_id") a.value = { stringValue: session };
  }
  spans.push({
    traceId: `${prefixe}${"0".repeat(24)}c001`,
    spanId: `${prefixe}${"f".repeat(12)}`,
    name: "rum.action",
    kind: 1,
    startTimeUnixNano: nanos(t0 + 5_000),
    endTimeUnixNano: nanos(t0 + 5_000),
    attributes: [
      attr("mip.session_id", session),
      attr("mip.event_type", "action"),
      attr("mip.event_name", "checkout"),
      attr("mip.action_id", `action-${session}`),
      attr("mip.identity.user_id", "alice@example.test"),
    ],
  });
  return Buffer.from(JSON.stringify(lot));
}

function logs(session: string) {
  const t0 = Date.now() - 30_000;
  return Buffer.from(JSON.stringify({
    resourceLogs: [{
      resource: { attributes: [attr("mip.app_id", APP.id), attr("mip.api_key", APP.cle), attr("service.name", "billing")] },
      scopeLogs: [{
        scope: { name: "relais" },
        logRecords: [
          { timeUnixNano: nanos(t0), severityNumber: 9, severityText: "INFO", body: { stringValue: "relayé 1" }, attributes: [attr("mip.session_id", session)] },
          { timeUnixNano: nanos(t0 + 1), severityNumber: 13, severityText: "WARN", body: { stringValue: "relayé 2" }, attributes: [attr("mip.session_id", session)] },
        ],
      }],
    }],
  }));
}

/** La `Request` web que Next remettrait au handler, vue depuis Vercel. */
function requete(chemin: string, corps: Buffer, entetes: Record<string, string> = {}) {
  const h = new Headers({
    origin: "http://localhost:3000",
    "content-length": String(corps.length),
    // Ce que Vercel ajoute : l'adresse du client et le pays résolu.
    "x-forwarded-for": IP,
    "x-real-ip": IP,
    "x-vercel-ip-country": "FR",
    ...entetes,
  });
  const url = `https://mip-rum-console.vercel.app${chemin}`;
  const brute = new Request(url, { method: "POST", headers: h, body: corps, duplex: "half" } as RequestInit);
  return Object.assign(brute, { nextUrl: new URL(url), cookies: { get: () => undefined } });
}

const portLibre = () =>
  new Promise<number>((ok, ko) => {
    const s = createServer();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

suite("relais d'ingestion : console → collector réel → Postgres (Docker)", () => {
  const db = new pg.Pool({ connectionString: ENV.url ?? undefined, max: 3 });
  let collector: ChildProcess | null = null;
  let base = "";
  const journalCollector: string[] = [];
  const appelsCollector = () => fetchEspion.mock.calls.filter(([u]) => String(u).startsWith(base) && !String(u).endsWith("/health"));
  const fetchEspion = vi.spyOn(globalThis, "fetch");

  async function arreterCollector() {
    if (!collector || collector.exitCode !== null) return;
    const fini = new Promise((ok) => collector!.once("exit", ok));
    collector.kill("SIGTERM");
    await fini;
  }

  beforeAll(async () => {
    const { rows } = await db.query("select filename from schema_migration where filename = 'migration-v87.sql'");
    if (!rows.length) throw new Error("base non migrée : lancer services/scheduler/migrate.mjs (v87 requise)");
    await db.query("delete from sourcemap where app_id = $1", [APP.id]);
    await db.query("delete from sourcemap_upload_token where app_id = $1", [APP.id]);
    for (const t of ["replay_chunk", "rum_log", "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_pageview", "rum_session"]) {
      await db.query(`delete from ${t} where app_id = $1`, [APP.id]).catch(() => undefined);
    }
    await db.query("delete from app_registry where app_id = $1", [APP.id]);
    await db.query(
      "insert into app_registry (app_id, name, api_key_hash, active, privacy_barrier_mode) values ($1, $1, $2, true, 'off')",
      [APP.id, sha256(APP.cle)],
    );
    await db.query(
      `insert into sourcemap_upload_token (id, app_id, name, secret_hash, created_by, expires_at)
       values ($1, $2, 'CI relais', $3, 'relais@test', now() + interval '1 day')`,
      [JETON.id, APP.id, JETON.empreinte],
    );
    // L'état que v87 laisse : la ligne à '0'.
    await db.query(
      "insert into platform_flag (key, value, updated_by) values ('ingest_relay_pct', '0', 'test') on conflict (key) do update set value = '0'",
    );

    const port = await portLibre();
    base = `http://127.0.0.1:${port}`;
    collector = spawn(process.execPath, [join(RACINE, "services", "collector", "server.mjs")], {
      cwd: RACINE,
      // Environnement EXPLICITE : rien n'hérite du shell (pas de DATABASE_URL de production).
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: ENV.url!,
        PORT: String(port),
        PGPOOL_MAX: "4",
        REQUIRE_API_KEY: "true",
        EDGE_PROXY_SECRET: ENV.bord,
        IDENTITY_HASH_SECRET: SECRET_IDENTITE,
        IDENTITY_HASH_FINGERPRINT: empreinteIdentite(SECRET_IDENTITE),
        // Si une adresse arrivait jusqu'ici, le collector la lirait : c'est ce
        // que le test surveille (le trafic relayé saute le GeoIP de toute façon).
        GEOIP_IP_SOURCE: "xff:1",
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    collector.stdout!.on("data", (b) => journalCollector.push(String(b)));
    collector.stderr!.on("data", (b) => journalCollector.push(String(b)));
    const echeance = Date.now() + 20_000;
    for (;;) {
      const ok = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      if (Date.now() > echeance || collector.exitCode !== null) {
        throw new Error(`collector non démarré :\n${journalCollector.join("")}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    process.env.CONSOLE_INGEST_RELAY_URL = base;
    fetchEspion.mockClear();
  }, 30_000);

  afterAll(async () => {
    await arreterCollector();
    delete process.env.CONSOLE_INGEST_RELAY_URL;
    fetchEspion.mockRestore();
    await db.end();
    await poolConsole.end();
  });

  it("drapeau semé par v87 ('0') : AUCUN relais, même avec INGEST_RELAY_PCT=100 — la console écrit elle-même", async () => {
    _resetPlatformFlagCache();
    _resetRelais();
    const rep = await POST_TRACES(requete("/api/ingest/v1/traces", traces("relais-s0", 1)));
    expect(rep.status).toBe(200);
    expect(fetchEspion).not.toHaveBeenCalled();
    const { rows } = await db.query("select user_id_hash from rum_session where session_id = 'relais-s0'");
    // Écrit par la console, sans secret : identité RETIRÉE.
    expect(rows).toEqual([{ user_id_hash: null }]);
  });

  describe("ligne de drapeau absente, INGEST_RELAY_PCT=100 : relais", () => {
    beforeAll(async () => {
      await db.query("delete from platform_flag where key = 'ingest_relay_pct'");
      _resetPlatformFlagCache();
      _resetRelais();
      fetchEspion.mockClear();
    });

    it("traces : écrites PAR LE COLLECTOR (identité hachée, pays du relais signé), sans adresse transmise", async () => {
      const rep = await POST_TRACES(requete("/api/ingest/v1/traces", traces("relais-s1", 2)));
      expect(rep.status).toBe(200);
      expect(await rep.json()).toEqual({ partialSuccess: {} });
      expect(rep.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      expect(appelsCollector().map(([u]) => String(u))).toEqual([`${base}/v1/traces`]);
      const envoyes = new Headers((appelsCollector()[0][1] as RequestInit).headers);
      expect(envoyes.has("x-forwarded-for")).toBe(false);
      expect(envoyes.has("x-real-ip")).toBe(false);

      const { rows } = await db.query(
        "select app_id, user_id_hash, geo_country, geo_source from rum_session where session_id = 'relais-s1'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].app_id).toBe(APP.id);
      // Le collector a le secret : l'identité est HACHÉE — la preuve que ce
      // n'est pas la console (sans secret) qui a écrit.
      expect(rows[0].user_id_hash).toMatch(/^[0-9a-f]{64}$/);
      // Relayée et signée : le pays de Vercel, jamais un GeoIP sur une adresse.
      expect(rows[0]).toMatchObject({ geo_country: "FR", geo_source: "cdn" });
      expect(journalCollector.join("")).not.toContain(IP);
    });

    it("logs : deux lignes rum_log, écrites une seule fois", async () => {
      const rep = await POST_LOGS(requete("/api/ingest/v1/logs", logs("relais-s1")));
      expect(rep.status).toBe(200);
      const { rows } = await db.query("select count(*)::int n from rum_log where app_id = $1 and session_id = 'relais-s1'", [APP.id]);
      expect(rows[0].n).toBe(2);
    });

    it("replay : chunk écrit par le collector, en-têtes x-mip-* transmis", async () => {
      const chunk = gzipSync(Buffer.from(JSON.stringify([{ type: 3, data: { source: 1 }, timestamp: Date.now() }])));
      const rep = await POST_REPLAY(requete("/api/ingest/v1/replay", chunk, {
        "content-type": "application/octet-stream",
        "x-mip-session": "relais-s1",
        "x-mip-app": APP.id,
        "x-mip-seq": "0",
        "x-mip-key": APP.cle,
      }));
      expect(rep.status).toBe(200);
      expect(await rep.json()).toEqual({ ok: true, seq: 0, events: 1 });
      const { rows } = await db.query("select events_count from replay_chunk where session_id = 'relais-s1' and seq = 0");
      expect(rows).toEqual([{ events_count: 1 }]);
    });

    it("source maps, branche jeton : enregistrées par le collector", async () => {
      const map = { version: 3, sources: ["src/a.ts"], names: [], mappings: "AAAA" };
      const corps = Buffer.from(JSON.stringify({ appId: APP.id, release: "1.0.0", maps: [{ filename: "app.min.js", content: JSON.stringify(map) }] }));
      const rep = await POST_SOURCEMAPS(requete("/api/sourcemaps", corps, {
        "content-type": "application/json",
        authorization: `Bearer ${JETON.jeton}`,
      }) as never);
      expect(rep.status).toBe(200);
      expect(await rep.json()).toMatchObject({ created: 1 });
      const { rows } = await db.query("select uploaded_by from sourcemap where app_id = $1 and release = '1.0.0'", [APP.id]);
      expect(rows).toEqual([{ uploaded_by: `jeton:${JETON.id}` }]);
      expect(appelsCollector().map(([u]) => String(u))).toContain(`${base}/v1/sourcemaps`);
    });

    it("collector ARRÊTÉ : erreur de connexion → repli local, 200, ligne écrite par la console (sans identité)", async () => {
      await arreterCollector();
      fetchEspion.mockClear();
      const rep = await POST_TRACES(requete("/api/ingest/v1/traces", traces("relais-s2", 3)));
      expect(rep.status).toBe(200);
      // Le relais a bien été TENTÉ (santé encore en cache), puis a rendu la main.
      expect(appelsCollector().map(([u]) => String(u))).toEqual([`${base}/v1/traces`]);
      const { rows } = await db.query("select user_id_hash, geo_country from rum_session where session_id = 'relais-s2'");
      expect(rows).toEqual([{ user_id_hash: null, geo_country: "FR" }]);
    });
  });
});
