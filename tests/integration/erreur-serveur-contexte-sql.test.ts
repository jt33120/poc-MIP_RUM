// Migration-v110 — une exception serveur venue d'un JOURNAL reprend la session et la
// route de son span serveur, quel que soit l'ordre d'arrivée, par les DEUX chemins
// d'écriture (historique et un aller-retour, v109).
//
// LE DÉFAUT CORRIGÉ. Les agents OpenTelemetry officiels (Java, .NET, Python)
// exportent leurs journaux avant leurs spans : l'exception était comptée par le
// journal ERROR du framework, sans session ni route, et le span 500 arrivé ensuite
// n'y changeait rien (otlp-agents-java-dotnet-python-sql.test.ts).
//
// CE QUE CE FICHIER PROUVE, chaque scénario joué par le chemin historique puis par
// la fonction SQL sur une base remise à zéro — mêmes bilans, mêmes lignes :
//   · journal puis span, span puis journal, les deux dans un même lot, rejeu :
//     UNE erreur, `origin_signal = 'log'`, la session et la route du span ;
//   · ce que l'erreur porte déjà n'est pas remplacé ;
//   · la session n'est reprise que si elle existe dans la MÊME application et
//     n'est sous aucune barrière d'effacement ; la route, elle, l'est ;
//   · un span d'une autre application, ou un span de détail, ne complète rien ;
//   · au-delà d'une heure d'ingestion, l'erreur n'est plus complétée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm vitest run tests/integration/erreur-serveur-contexte-sql.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { _resetColonnesCache, writeLogs, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetUnAR } from "../../packages/backend/lib/ingest-un-ar.mjs";
// @ts-expect-error module JS sans déclarations
import { _resetPresenceBarrieres } from "../../packages/backend/lib/privacy-barriere.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP = "v110-a";
const AUTRE = "v110-b";
const APPS = [APP, AUTRE];
const SESSION = "s-v110-navigateur";
const SESSION_AUTRE = "s-v110-autre-app";
const TRACE_ID = "a1100000000000000000000000000002";
const SPAN_SERVEUR = "b110000000000002";
const NOW = Date.now();
const ROUTE = "/factures/:id/payer";

type Chemin = "historique" | "un_ar";
type Ligne = Record<string, unknown>;
type Etape = (chemin: Chemin) => Promise<unknown>;

const attr = (key: string, value: string | number) =>
  ({ key, value: typeof value === "number" ? { intValue: value } : { stringValue: value } });
const nanos = (decalageMs: number) => (BigInt(NOW + decalageMs) * 1_000_000n).toString();

/** Le span SERVER d'un agent officiel : `http.route`, statut 500, session par le `tracestate`. */
function lotSpan(app: string, { session = SESSION, spanId = SPAN_SERVEUR, kind = 2 }: { session?: string; spanId?: string; kind?: number } = {}) {
  return flattenOtlp({
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", app), attr("service.name", "factures-v110"), attr("telemetry.sdk.language", "java")] },
      scopeSpans: [{ spans: [{
        name: "POST /factures/{id}/payer",
        kind,
        traceId: TRACE_ID,
        spanId,
        parentSpanId: "c110000000000002",
        traceState: `mip=s:${session}`,
        startTimeUnixNano: nanos(-2_000),
        endTimeUnixNano: nanos(-1_990),
        attributes: [
          attr("http.request.method", "POST"), attr("http.route", "/factures/{id}/payer"),
          attr("url.path", "/factures/42/payer"), attr("http.response.status_code", 500),
        ],
      }] }],
    }],
  }, { now: NOW });
}

/** Le journal ERROR du framework, dans le span serveur : trace et span, ni session ni route. */
function lotJournal(app: string, extra: { key: string; value: Record<string, unknown> }[] = []) {
  return flattenOtlpLogs({
    resourceLogs: [{
      resource: { attributes: [attr("mip.app_id", app), attr("service.name", "factures-v110"), attr("telemetry.sdk.language", "java")] },
      scopeLogs: [{ scope: { name: "org.apache.catalina.core" }, logRecords: [{
        timeUnixNano: nanos(-1_995),
        severityNumber: 17,
        traceId: TRACE_ID,
        spanId: SPAN_SERVEUR,
        body: { stringValue: "Servlet.service() a levé une exception" },
        attributes: [
          attr("exception.type", "java.lang.IllegalStateException"),
          attr("exception.message", "paiement refusé : facture déjà soldée"),
          attr("exception.stacktrace", "java.lang.IllegalStateException: paiement refusé\n\tat Factures.payer(Factures.java:42)"),
          ...extra,
        ],
      }] }],
    }],
  }, { now: NOW });
}

const traces = (rows: unknown): Etape => (chemin) => writeRows(pool, rows, { chemin, symbolicateur: null });
const journaux = (lot: { logs: unknown[]; errors: unknown[] }): Etape => (chemin) => writeLogs(pool, lot.logs, lot.errors, { chemin });
const sql = (texte: string, params: unknown[] = []): Etape => async () => { await pool.query(texte, params); return "sql"; };
/** La session du navigateur, ancrée comme par un lot du SDK web. */
const ancre = (app: string, session: string) =>
  sql("insert into rum_session (session_id, app_id, started_at, last_seen_at) values ($1, $2, now(), now()) on conflict do nothing", [session, app]);

async function nettoyer() {
  for (const t of ["rum_error", "rum_log", "rum_span", "rum_session", "privacy_erasure_barrier"]) {
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
  }
  _resetPresenceBarrieres();
  _resetColonnesCache();
  _resetUnAR(pool);
}

async function erreurs(): Promise<Ligne[]> {
  const { rows } = await pool.query(
    `select app_id, span_id, trace_id, source_parent_span_id, session_id, route, origin_signal, error_type
       from rum_error where app_id = any($1::text[]) order by app_id, span_id`,
    [APPS],
  );
  return rows;
}

async function jouer(chemin: Chemin, etapes: Etape[]) {
  await nettoyer();
  const bilans: unknown[] = [];
  for (const etape of etapes) bilans.push(await etape(chemin));
  return { bilans, lignes: await erreurs() };
}

/** Le même scénario par les deux chemins : mêmes bilans, mêmes lignes. */
async function equivalents(etapes: Etape[]) {
  const historique = await jouer("historique", etapes);
  const unAR = await jouer("un_ar", etapes);
  expect(unAR.bilans).toEqual(historique.bilans);
  expect(unAR.lignes).toEqual(historique.lignes);
  return historique;
}

const complete = expect.objectContaining({
  app_id: APP, trace_id: TRACE_ID, source_parent_span_id: SPAN_SERVEUR,
  session_id: SESSION, route: ROUTE, origin_signal: "log", error_type: "java.lang.IllegalStateException",
});

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

suite("migration-v110 — l'exception d'un journal reprend la session et la route de son span", () => {
  it("le lot de spans porte bien une exception… et aucune : seul le journal compte la panne", () => {
    expect(lotSpan(APP).spans).toEqual([expect.objectContaining({ tier: "back", route: ROUTE, session_id: SESSION })]);
    expect(lotSpan(APP).errors).toEqual([]);
    expect(lotJournal(APP).errors).toEqual([expect.objectContaining({ origin_signal: "log", route: null, session_claim: null })]);
  });

  it("journal puis span, lots séparés : l'erreur est complétée à l'arrivée du span", async () => {
    const { bilans, lignes } = await equivalents([ancre(APP, SESSION), journaux(lotJournal(APP)), traces(lotSpan(APP))]);
    expect(lignes).toEqual([complete]);
    expect((bilans[1] as { erreurs: { inserees: number } }).erreurs.inserees).toBe(1);
  });

  it("span puis journal : l'erreur naît complète", async () => {
    const { lignes } = await equivalents([ancre(APP, SESSION), traces(lotSpan(APP)), journaux(lotJournal(APP))]);
    expect(lignes).toEqual([complete]);
  });

  it("dans un même lot (l'erreur du journal et le span écrits par un seul appel)", async () => {
    const lot = { ...lotSpan(APP), errors: lotJournal(APP).errors };
    const { lignes } = await equivalents([ancre(APP, SESSION), traces(lot)]);
    expect(lignes).toEqual([complete]);
  });

  it("rejeu des mêmes corps, dans les deux ordres : toujours UNE erreur, toujours complète", async () => {
    const { bilans, lignes } = await equivalents([
      ancre(APP, SESSION),
      journaux(lotJournal(APP)),
      traces(lotSpan(APP)),
      journaux(lotJournal(APP)),
      traces(lotSpan(APP)),
      traces(lotSpan(APP)),
      journaux(lotJournal(APP)),
    ]);
    expect(lignes).toEqual([complete]);
    const inserees = bilans.map((b) => (b as { erreurs?: { inserees: number } })?.erreurs?.inserees);
    expect(inserees).toEqual([undefined, 1, 0, 0, 0, 0, 0]);
  });

  it("ce que l'erreur porte déjà n'est pas remplacé : la route du journal reste, la session vient du span", async () => {
    const journal = lotJournal(APP, [attr("mip.route", "/route-du-journal")]);
    for (const ordre of [[journaux(journal), traces(lotSpan(APP))], [traces(lotSpan(APP)), journaux(journal)]]) {
      const { lignes } = await equivalents([ancre(APP, SESSION), ...ordre]);
      expect(lignes).toEqual([expect.objectContaining({ session_id: SESSION, route: "/route-du-journal" })]);
    }
  });

  it("session inconnue, ou d'une AUTRE application : la route est reprise, la session non", async () => {
    for (const ordre of ["journal", "span"]) {
      const etapes = [
        ancre(AUTRE, SESSION_AUTRE),
        ...(ordre === "journal"
          ? [journaux(lotJournal(APP)), traces(lotSpan(APP, { session: SESSION_AUTRE }))]
          : [traces(lotSpan(APP, { session: SESSION_AUTRE })), journaux(lotJournal(APP))]),
      ];
      const { lignes } = await equivalents(etapes);
      expect(lignes, ordre).toEqual([expect.objectContaining({ session_id: null, route: ROUTE })]);
    }
    const { lignes } = await equivalents([journaux(lotJournal(APP)), traces(lotSpan(APP, { session: "s-v110-jamais-vue" }))]);
    expect(lignes).toEqual([expect.objectContaining({ session_id: null, route: ROUTE })]);
  });

  it("la barrière : une session effacée n'est jamais reprise", async () => {
    // Span déjà écrit, puis effacement de la session (barrière posée), puis le journal.
    const avant = await equivalents([
      ancre(APP, SESSION),
      traces(lotSpan(APP)),
      sql("insert into privacy_erasure_barrier (app_id, subject_kind, subject_key) values ($1, 'session', $2)", [APP, SESSION]),
      journaux(lotJournal(APP)),
    ]);
    expect(avant.lignes).toEqual([expect.objectContaining({ session_id: null, route: ROUTE })]);
    // Journal d'abord, puis effacement, puis le span : le lot de spans est refusé.
    const apres = await equivalents([
      ancre(APP, SESSION),
      journaux(lotJournal(APP)),
      sql("insert into privacy_erasure_barrier (app_id, subject_kind, subject_key) values ($1, 'session', $2)", [APP, SESSION]),
      traces(lotSpan(APP)),
    ]);
    expect(apres.lignes).toEqual([expect.objectContaining({ session_id: null, route: null })]);
    expect((apres.bilans[3] as { refuses?: Record<string, number> }).refuses).toMatchObject({ spans: 1 });
  });

  it("un span d'une autre application, ou un span qui n'est pas serveur, ne complète rien", async () => {
    const { lignes } = await equivalents([
      ancre(APP, SESSION),
      ancre(AUTRE, SESSION_AUTRE),
      journaux(lotJournal(APP)),
      traces(lotSpan(AUTRE, { session: SESSION_AUTRE })),
    ]);
    expect(lignes).toEqual([expect.objectContaining({ app_id: APP, session_id: null, route: null })]);

    // Le journal dans un span INTERNE (tier `detail`) : pas de remontée au serveur.
    const interne = await equivalents([ancre(APP, SESSION), journaux(lotJournal(APP)), traces(lotSpan(APP, { kind: 1 }))]);
    expect(interne.lignes).toEqual([expect.objectContaining({ session_id: null, route: null })]);
  });

  it("au-delà d'une heure d'ingestion, l'erreur n'est plus complétée", async () => {
    const { lignes } = await equivalents([
      ancre(APP, SESSION),
      journaux(lotJournal(APP)),
      sql("update rum_error set ingested_at = now() - interval '61 minutes' where app_id = $1", [APP]),
      traces(lotSpan(APP)),
    ]);
    expect(lignes).toEqual([expect.objectContaining({ session_id: null, route: null })]);
  });
});
