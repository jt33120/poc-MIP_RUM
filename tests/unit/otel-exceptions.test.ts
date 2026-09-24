// P5.3 — exceptions backend et OpenTelemetry : parseur et écrivains.
//
// La preuve sur PostgreSQL (unicité, sessions, métering, effacements) est dans
// tests/integration/error-backend-otel-sql.test.ts. Ici on verrouille ce qui se
// décide AVANT la base : quelles exceptions sont lues et où, leur identité, leur
// source, leur normalisation, leurs bornes, et le SQL que chaque écrivain envoie
// selon le schéma qu'il trouve.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  backendErrorSource,
  errorFingerprint,
  exceptionIdentity,
  flattenOtlp,
  flattenOtlpLogs,
  MAX_EXCEPTION_EVENTS_PER_SPAN,
  // @ts-expect-error module JS partagé sans déclarations
} from "../../packages/backend/shared/otlp.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeLogs, writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;

const APP = "otel-exceptions";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";
const ID = "0123456789abcdef0123456789abcdef";
const NOW = Date.now();
const nanos = (ms: number) => `${ms}000000`;

const kv = (key: string, value: unknown) => ({
  key,
  value: typeof value === "boolean" ? { boolValue: value }
    : typeof value === "number" ? { intValue: String(value) }
      : { stringValue: String(value) },
});
const attributs = (attrs: Attrs) => Object.entries(attrs).map(([key, value]) => kv(key, value));

const erreur = (over: Attrs = {}): Attrs => ({
  "exception.type": "ValueError",
  "exception.message": "montant négatif",
  "exception.stacktrace": "Traceback (most recent call last):\n  File \"app.py\", line 3, in payer\nValueError: montant négatif",
  ...over,
});

function evenement(attrs: Attrs, ms = NOW - 1_000) {
  return { name: "exception", timeUnixNano: nanos(ms), attributes: attributs(attrs) };
}

function traces(spans: Row[], resource: Attrs = { "service.name": "billing" }, scope = "opentelemetry.sdk", app = APP) {
  return {
    resourceSpans: [{
      resource: { attributes: attributs({ "mip.app_id": app, ...resource }) },
      scopeSpans: [{ scope: { name: scope }, spans }],
    }],
  };
}

function span(over: Row = {}, attrs: Attrs = {}, events: Row[] = [evenement(erreur())]): Row {
  return {
    traceId: TRACE,
    spanId: SPAN,
    kind: 2,
    name: "POST /invoices/{id}",
    startTimeUnixNano: nanos(NOW - 2_000),
    endTimeUnixNano: nanos(NOW - 1_990),
    attributes: attributs({ "http.request.method": "POST", "http.route": "/invoices/{id}", ...attrs }),
    events,
    ...over,
  };
}

function logs(records: Row[], resource: Attrs = { "service.name": "billing" }, scope = "opentelemetry.sdk._logs", app = APP) {
  return {
    resourceLogs: [{
      resource: { attributes: attributs({ "mip.app_id": app, ...resource }) },
      scopeLogs: [{ scope: { name: scope }, logRecords: records }],
    }],
  };
}

function log(attrs: Attrs = erreur(), over: Row = {}): Row {
  return {
    timeUnixNano: nanos(NOW - 1_000),
    observedTimeUnixNano: nanos(NOW - 999),
    severityNumber: 17,
    severityText: "ERROR",
    body: { stringValue: "échec facturation" },
    traceId: TRACE,
    spanId: SPAN,
    attributes: attributs(attrs),
    ...over,
  };
}

describe("parseur — exceptions portées par un span", () => {
  it("les lit sur chaque branche backend, AVANT leurs sorties, même quand le span est rejeté", () => {
    const branches: Array<[string, Row]> = [
      ["http.server du middleware", span({ name: "http.server" }, { "mip.trace_id": TRACE, "mip.span_id": SPAN, "http.duration_ms": 12 })],
      ["serveur OpenTelemetry", span()],
      ["detail (requête DB)", span({ kind: 3, name: "SELECT invoices" }, { "db.system": "postgresql" })],
      ["serveur rejeté faute de durée", span({ endTimeUnixNano: undefined })],
      ["span SVI", span({ name: "svi.step" })],
      ["span sans session ni trace utilisable", span({ kind: 1, name: "tâche", traceId: undefined, spanId: undefined },
        {}, [evenement(erreur({ "mip.exception_id": ID }))])],
    ];
    for (const [nom, s] of branches) {
      const rows = flattenOtlp(traces([s]), { now: NOW });
      expect(rows.errors, nom).toHaveLength(1);
      expect(rows.errors[0], nom).toMatchObject({ origin_signal: "span_event", session_id: null, message: "montant négatif" });
      expect(rows.sessions, nom).toEqual([]);
    }
  });

  it("une identité par événement : déterministe, distincte par position, app-scopée, jamais indexée", () => {
    const payload = () => traces([span({}, {}, [evenement(erreur()), evenement(erreur())])]);
    const a = flattenOtlp(payload(), { now: NOW });
    const b = flattenOtlp(payload(), { now: NOW });
    expect(a.errors.map((e: Row) => e.span_id)).toEqual(b.errors.map((e: Row) => e.span_id));
    const [premier, second] = a.errors;
    expect(premier.span_id).toMatch(/^[0-9a-f]{32}$/);
    expect(premier.span_id).not.toBe(second.span_id);
    expect(premier.source_parent_span_id).toBe(SPAN);
    expect(premier.span_id).toBe(exceptionIdentity(APP, ["span_event", TRACE, SPAN, 0, nanos(NOW - 1_000)]));
    const autreApp = flattenOtlp(traces([span({}, {}, [evenement(erreur())])], undefined, undefined, "autre-app"), { now: NOW });
    expect(autreApp.errors[0].span_id).not.toBe(premier.span_id);
    // Seul le span porteur est projeté : l'identité dérivée n'est pas un span.
    expect(a.eventIndex.map((i: Row) => [i.kind, i.source_span_id])).toEqual([["span", SPAN]]);
  });

  it("mip.exception_id : identité commune au log et au span ; forme invalide ignorée", () => {
    const parSpan = flattenOtlp(traces([span({}, {}, [evenement(erreur({ "mip.exception_id": ID.toUpperCase() }))])]), { now: NOW });
    const parLog = flattenOtlpLogs(logs([log(erreur({ "mip.exception_id": ID }))]), { now: NOW });
    expect(parSpan.errors[0]).toMatchObject({ exception_id: ID, span_id: exceptionIdentity(APP, ["id", ID]) });
    expect(parLog.errors[0]).toMatchObject({ exception_id: ID, span_id: parSpan.errors[0].span_id, origin_signal: "log" });
    for (const invalide of ["alice@example.test", "123", `${ID}0`]) {
      const [row] = flattenOtlp(traces([span({}, {}, [evenement(erreur({ "mip.exception_id": invalide }))])]), { now: NOW }).errors;
      expect(row.exception_id, invalide).toBeNull();
      expect(row.span_id).toBe(exceptionIdentity(APP, ["span_event", TRACE, SPAN, 0, nanos(NOW - 1_000)]));
    }
  });

  it("session revendiquée (attribut puis tracestate), jamais écrite telle quelle, bornée", () => {
    const parAttribut = flattenOtlp(traces([span({ traceState: "mip=s:ts-1" }, { "mip.session_id": "attr-1" })]), { now: NOW });
    expect(parAttribut.errors[0]).toMatchObject({ session_id: null, session_claim: "attr-1" });
    const parTracestate = flattenOtlp(traces([span({ traceState: "vendor=x,mip=s:ts-1" })]), { now: NOW });
    expect(parTracestate.errors[0]).toMatchObject({ session_id: null, session_claim: "ts-1" });
    for (const hostile of ["a".repeat(129), "sess\nion"]) {
      const [row] = flattenOtlp(traces([span({}, { "mip.session_id": hostile })]), { now: NOW }).errors;
      expect(row.session_claim).toBeNull();
    }
  });

  it("source selon le runtime déclaré ; service, env et release du backend conservés", () => {
    const source = (resource: Attrs, scope = "opentelemetry.sdk") =>
      flattenOtlp(traces([span()], resource, scope), { now: NOW }).errors[0];
    expect(source({ "service.name": "api" }, "@mip/agent-node").error_source).toBe("node");
    expect(source({ "service.name": "api" }, "mip-rum-fastapi").error_source).toBe("python");
    expect(source({ "telemetry.sdk.language": "nodejs" }).error_source).toBe("node");
    expect(source({ "process.runtime.name": "CPython" }).error_source).toBe("python");
    expect(source({ "telemetry.sdk.language": "webjs" }).error_source).toBe("browser_js");
    expect(source({ "telemetry.sdk.language": "java" }).error_source).toBe("otel");
    expect(source({ "service.name": "mip-rum-web", "service.version": "0.4.0", "mip.release": "2.0.0" }))
      .toMatchObject({ error_source: "browser_js", service: null, release: "2.0.0" });
    // Pour un backend, `service.version` EST sa version ; pour le SDK web, c'était la sienne.
    expect(source({ "service.name": "billing", "service.version": "7.1.0", "deployment.environment.name": "prod" }))
      .toMatchObject({ error_source: "otel", service: "billing", release: "7.1.0", env: "prod" });
    expect(source({ "service.name": "mip-rum-web", "service.version": "0.4.0" }).release).toBeNull();
    expect(backendErrorSource({}, null)).toBe("otel");
  });

  it("même normalisation qu'une erreur navigateur : scrub avant troncature, bornes, NUL, empreinte", () => {
    const attrs = erreur({
      "exception.type": "T".repeat(300),
      "exception.message": `carte 4111 1111 1111 1111 de alice@example.test ${"x".repeat(2_000)}`,
      "exception.stacktrace": `Error\u0000 token=secret123\n${"y".repeat(9_000)}`,
    });
    const [derivee] = flattenOtlp(traces([span({}, {}, [evenement(attrs)])]), { now: NOW }).errors;
    const [navigateur] = flattenOtlp(traces([{
      traceId: TRACE, spanId: "00f067aa0ba902b8", name: "exception", startTimeUnixNano: nanos(NOW - 1_000),
      attributes: attributs({ ...attrs, "mip.session_id": "s-web" }),
    }], { "service.name": "mip-rum-web" }), { now: NOW }).errors;
    for (const champ of ["error_type", "message", "stack", "fingerprint"]) {
      expect(derivee[champ], champ).toEqual(navigateur[champ]);
    }
    expect(derivee.error_type).toHaveLength(200);
    expect(derivee.message).toMatch(/^carte \[number\] de \[email\] x+$/);
    expect(derivee.message).toHaveLength(1_000);
    expect(derivee.stack).toHaveLength(4_000);
    expect(derivee.stack).not.toContain("secret123");
    expect(derivee.stack).not.toContain("\u0000");
    expect(derivee.fingerprint).toBe(errorFingerprint(derivee.error_type, derivee.message, derivee.stack));
  });

  it("géré et fatal : seulement quand l'émetteur les déclare", () => {
    const [declare] = flattenOtlp(traces([span({}, {}, [evenement(erreur({ "mip.error_handled": false, "mip.error_fatal": true }))])]), { now: NOW }).errors;
    expect(declare).toMatchObject({ handled: false, is_fatal: true });
    const [inconnu] = flattenOtlp(traces([span()]), { now: NOW }).errors;
    expect(inconnu).toMatchObject({ handled: null, is_fatal: null, kind: "error", occurrences: 1 });
  });

  it("bornes : 16 exceptions par span, budget par requête, événements malformés rejetés", () => {
    const vingt = Array.from({ length: 20 }, () => evenement(erreur()));
    const borne = flattenOtlp(traces([span({}, {}, vingt)]), { now: NOW });
    expect(borne.errors).toHaveLength(MAX_EXCEPTION_EVENTS_PER_SPAN);
    expect(borne.rejected).toBe(20 - MAX_EXCEPTION_EVENTS_PER_SPAN);

    const budget = flattenOtlp(traces([span({}, {}, vingt.slice(0, 3))]), { now: NOW, maxSpans: 2 });
    expect(budget.errors).toHaveLength(2);
    expect(budget.rejected).toBe(1);

    const malformes = flattenOtlp(traces([
      span({}, {}, [
        evenement({ "exception.stacktrace": "sans type ni message" }),
        evenement({ "exception.type": "   " }),
        { name: "log", attributes: attributs(erreur()) },
      ]),
      span({ spanId: undefined }, {}, [evenement(erreur())]),
    ]), { now: NOW });
    expect(malformes.errors).toEqual([]);
    // Deux événements sans type ni message, l'exception d'un span sans identifiant
    // (aucune clé stable possible), et ce span serveur lui-même. Un événement
    // qui n'est pas `exception` n'est pas une exception, rejetée ou non.
    expect(malformes.rejected).toBe(4);
  });

  it("un span dédié `exception` reste une seule erreur, même porteur d'un événement", () => {
    const rows = flattenOtlp(traces([{
      traceId: TRACE, spanId: SPAN, name: "exception", startTimeUnixNano: nanos(NOW - 1_000),
      attributes: attributs({ ...erreur(), "mip.session_id": "s-web" }), events: [evenement(erreur())],
    }], { "service.name": "mip-rum-web" }), { now: NOW });
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toMatchObject({ span_id: SPAN, session_id: "s-web" });
    expect(rows.errors[0]).not.toHaveProperty("origin_signal");
  });
});

describe("parseur — exceptions portées par un log", () => {
  it("un log ERROR avec `exception.*` produit AUSSI une erreur ; le log reste écrit", () => {
    const parsed = flattenOtlpLogs(logs([log(erreur({ "mip.session_id": "s-1", "mip.route": "/factures" }))], {
      "service.name": "billing", "telemetry.sdk.language": "python",
    }), { now: NOW });
    expect(parsed.logs).toHaveLength(1);
    expect(parsed.errors).toEqual([expect.objectContaining({
      origin_signal: "log", error_source: "python", service: "billing", trace_id: TRACE,
      source_parent_span_id: SPAN, session_id: null, session_claim: "s-1", route: "/factures",
      error_type: "ValueError", exception_id: null,
    })]);
    expect(parsed.errors[0].span_id).toBe(
      exceptionIdentity(APP, ["log", TRACE, SPAN, nanos(NOW - 1_000), nanos(NOW - 999), 1]),
    );
  });

  it("texte seul, gravité sous ERROR ou log sans aucun horodatage : pas d'exception", () => {
    const parsed = flattenOtlpLogs(logs([
      log({}),
      log(erreur(), { severityNumber: 13, severityText: "WARN" }),
      log(erreur(), { severityNumber: 9, severityText: "INFO" }),
      log(erreur(), { timeUnixNano: undefined, observedTimeUnixNano: undefined }),
    ]), { now: NOW });
    expect(parsed.logs).toHaveLength(4);
    expect(parsed.errors).toEqual([]);
  });

  it("sans severityNumber, le texte de gravité décide ; un identifiant suffit sans horodatage", () => {
    const parsed = flattenOtlpLogs(logs([
      log(erreur(), { severityNumber: undefined, severityText: "FATAL" }),
      log(erreur(), { severityNumber: 0, severityText: "error2" }),
      log(erreur(), { severityNumber: undefined, severityText: "warning" }),
      log(erreur({ "mip.exception_id": ID }), { timeUnixNano: undefined, observedTimeUnixNano: undefined }),
    ]), { now: NOW });
    expect(parsed.errors).toHaveLength(3);
  });

  it("deux logs identiques d'un lot restent deux lignes ; le rejeu du lot redonne les mêmes clés", () => {
    const lot = () => logs([log(), log()]);
    const a = flattenOtlpLogs(lot(), { now: NOW }).errors.map((e: Row) => e.span_id);
    const b = flattenOtlpLogs(lot(), { now: NOW }).errors.map((e: Row) => e.span_id);
    expect(new Set(a).size).toBe(2);
    expect(b).toEqual(a);
  });
});

// ───────────────────────────── Écrivain PostgreSQL ────────────────────────────

const V69 = [
  "occurrences", "action_id", "trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal",
  "context", "view_id", "view_name", "user_id_hash", "account_id_hash", "env", "service",
];
const V70 = [...V69, "origin_signal", "exception_id"];

interface Appel { sql: string; params: unknown[] }

/** Base simulée : colonnes de rum_error, sessions existantes, lignes rendues par RETURNING. */
function fakePool(colonnes: string[], sessions: Array<[string, string]> = []) {
  const appels: Appel[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (sql.includes("information_schema.columns")) {
      return { rows: params[0] === "rum_error" ? colonnes.map((column_name) => ({ column_name })) : [] };
    }
    if (sql.startsWith("select app_id, session_id from rum_session")) {
      const [apps, ids] = params as [string[], string[]];
      return {
        rows: sessions
          .filter(([app, id]) => apps.some((a, i) => a === app && ids[i] === id))
          .map(([app_id, session_id]) => ({ app_id, session_id })),
      };
    }
    if (sql.startsWith("insert into rum_error")) {
      const lignes = params.length / (sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").length);
      return { rows: Array.from({ length: lignes }, (_, id) => ({ id })) };
    }
    return { rows: [] };
  };
  return { appels, pool: { connect: async () => ({ query, release() {} }) } };
}

function lignesInserees(appels: Appel[]): Row[] {
  return appels.filter(({ sql }) => sql.startsWith("insert into rum_error")).flatMap(({ sql, params }) => {
    const colonnes = /^insert into rum_error \(([^)]*)\)/.exec(sql)![1].split(",");
    const rows: Row[] = [];
    for (let i = 0; i < params.length; i += colonnes.length) {
      rows.push(Object.fromEntries(colonnes.map((c, j) => [c, params[i + j]])));
    }
    return rows;
  });
}

const vide = {
  sessions: [], pageviews: [], metrics: [], errors: [], resources: [], longtasks: [], breadcrumbs: [],
  events: [], spans: [], sviCalls: [], sviSteps: [], sviLegs: [],
};

/** Deux dérivées (session connue de l'app, session d'une autre app) et une erreur navigateur. */
function lotMixte() {
  const derivees = flattenOtlp(traces([
    span({ traceState: "mip=s:connue" }, {}, [evenement(erreur())]),
    span({ spanId: "00f067aa0ba902b9" }, { "mip.session_id": "etrangere" }, [evenement(erreur())]),
  ]), { now: NOW }).errors;
  const navigateur = flattenOtlp(traces([{
    traceId: TRACE, spanId: "00f067aa0ba902ba", name: "exception", startTimeUnixNano: nanos(NOW),
    attributes: attributs({ ...erreur(), "mip.session_id": "connue" }),
  }], { "service.name": "mip-rum-web" }), { now: NOW }).errors;
  return { ...vide, errors: [...derivees, ...navigateur] };
}

describe("écrivain PostgreSQL — erreurs dérivées", () => {
  beforeEach(() => _resetColonnesCache());

  it("v70 : origine écrite, session rattachée seulement si elle existe dans la même app, verrouillée", async () => {
    const { appels, pool } = fakePool(V70, [[APP, "connue"], ["autre-app", "etrangere"]]);
    expect(await writeRows(pool, lotMixte())).toEqual({ erreurs: { recues: 3, inserees: 3, ignorees: 0 } });
    const verification = appels.find(({ sql }) => sql.startsWith("select app_id, session_id from rum_session"))!;
    expect(verification.sql).toContain("for key share");
    expect(verification.params).toEqual([[APP, APP], ["connue", "etrangere"]]);
    const rows = lignesInserees(appels);
    expect(rows.map((r) => [r.origin_signal ?? null, r.session_id])).toEqual([
      ["span_event", "connue"],
      ["span_event", null],
      [null, "connue"],
    ]);
    expect(Object.keys(rows[0])).not.toContain("session_claim");
    // Aucune session créée pour une exception backend.
    expect(appels.some(({ sql }) => sql.startsWith("insert into rum_session"))).toBe(false);
  });

  it("avant v70 : les dérivées sont ignorées, l'erreur navigateur part, rien n'échoue", async () => {
    const { appels, pool } = fakePool(V69);
    expect(await writeRows(pool, lotMixte())).toEqual({ erreurs: { recues: 3, inserees: 1, ignorees: 2 } });
    const rows = lignesInserees(appels);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toContain("origin_signal");
    // Aucun RATTACHEMENT de session : c'est la requête `for key share` qui le
    // fait, et elle ne doit pas être émise quand les dérivées sont écartées. La
    // lecture de portée d'application (P8.1), elle, a bien lieu — elle vérifie
    // qu'aucun identifiant du lot n'appartient à un autre locataire.
    expect(appels.some(({ sql }) => sql.includes("for key share"))).toBe(false);
    expect(appels.at(-1)?.sql).toBe("commit");
  });

  it("RETURNING fait le compte, et un gros lot part en INSERT de 1 000 lignes", async () => {
    const { appels, pool } = fakePool(V70);
    const erreurs = Array.from({ length: 2_500 }, (_, i) => ({ ...lotMixte().errors[2], span_id: `navigateur-${i}` }));
    expect(await writeRows(pool, { ...vide, errors: erreurs })).toEqual({ erreurs: { recues: 2_500, inserees: 2_500, ignorees: 0 } });
    const inserts = appels.filter(({ sql }) => sql.startsWith("insert into rum_error"));
    expect(inserts).toHaveLength(3);
    for (const { sql } of inserts) expect(sql).toMatch(/on conflict \(span_id\) do nothing returning id$/);
  });

  it("writeLogs : log puis exceptions dans UNE transaction, annulée ensemble", async () => {
    const parsed = flattenOtlpLogs(logs([log()]), { now: NOW });
    const { appels, pool } = fakePool(V70);
    expect(await writeLogs(pool, parsed.logs, parsed.errors)).toEqual({ logs: 1, erreurs: { recues: 1, inserees: 1, ignorees: 0 } });
    const ordre = appels.map(({ sql }) => sql.split(" ").slice(0, 3).join(" ")).filter((s) => !s.startsWith("select column_name"));
    // P8.1 : la transaction commence par borner l'attente puis prendre le verrou
    // d'ingestion de l'app. L'ordre est une propriété — verrouiller APRÈS avoir
    // lu laisserait passer un effacement concurrent.
    expect(ordre).toEqual([
      "begin",
      "set local lock_timeout",
      "select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)",
      "insert into rum_log",
      "insert into rum_error",
      "commit",
    ]);

    const panne = fakePool(V70);
    const connect = panne.pool.connect;
    panne.pool.connect = async () => {
      const client = await connect();
      return {
        ...client,
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith("insert into rum_error")) throw Object.assign(new Error("panne"), { code: "57P01" });
          return client.query(sql, params);
        },
      };
    };
    await expect(writeLogs(panne.pool, parsed.logs, parsed.errors)).rejects.toThrow("panne");
    expect(panne.appels.at(-1)?.sql).toBe("rollback");
  });
});

// ───────────────────────── Middleware FastAPI réel ────────────────────────────

const PYTHON = (() => {
  try {
    execFileSync("python3", ["-c", "import asyncio, secrets, traceback"], { stdio: "ignore" });
    return "python3";
  } catch {
    return null;
  }
})();

describe.skipIf(!PYTHON)("middleware FastAPI réel -> ingestion", () => {
  it("l'exception d'une requête ASGI devient une erreur python rattachée à son span, sans session inventée", () => {
    const script = `
import asyncio, json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, "..", "..", "examples", "integrations", "fastapi"))})
import mip_rum_middleware as mrm

class Boom:
    async def __call__(self, scope, receive, send):
        raise KeyError("facture 42")

mw = mrm.MIPRumMiddleware(Boom(), endpoint="http://x/v1/traces", app_id=${JSON.stringify(APP)}, batch_size=1000)

async def main():
    scope = {"type": "http", "method": "POST", "path": "/invoices/42",
             "headers": [(b"traceparent", b"00-${TRACE}-${SPAN}-01"), (b"tracestate", b"mip=s:session-web")]}
    async def receive():
        return {"type": "http.request"}
    async def send(message):
        pass
    try:
        await mw(scope, receive, send)
    except KeyError:
        pass

asyncio.run(main())
print(json.dumps(mw._otlp(mw._buf)))
`;
    const payload = JSON.parse(execFileSync(PYTHON!, ["-c", script], { encoding: "utf8" }));
    const rows = flattenOtlp(payload);
    expect(rows.spans).toEqual([expect.objectContaining({ tier: "back", trace_id: TRACE, status_code: 500, session_id: "session-web" })]);
    expect(rows.errors).toEqual([expect.objectContaining({
      origin_signal: "span_event", error_source: "python", service: "fastapi", trace_id: TRACE,
      source_parent_span_id: rows.spans[0].span_id, session_id: null, session_claim: "session-web",
      error_type: "KeyError", message: "'facture 42'", handled: false, route: "/invoices/:id",
    })]);
    expect(rows.errors[0].stack).toContain("Traceback (most recent call last)");
    expect(rows.errors[0].exception_id).toMatch(/^[0-9a-f]{32}$/);
  });
});
