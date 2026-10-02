// P5.3 — exceptions backend et OpenTelemetry : parseur et écrivains.
//
// La preuve sur PostgreSQL (unicité, sessions, métering, effacements) est dans
// tests/integration/error-backend-otel-sql.test.ts. Ici on verrouille ce qui se
// décide AVANT la base : quelles exceptions sont lues et où, leur identité, leur
// source, leur normalisation, leurs bornes, et le SQL que chaque écrivain envoie
// selon le schéma qu'il trouve.
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
import { evenementException } from "../../packages/rum-sdk/src/otel";
import { buildResourceSpans, msToHr } from "../../packages/rum-sdk/src/otlp-encode";

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;

const APP = "otel-exceptions";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";
const ID = "0123456789abcdef0123456789abcdef";
const NOW = Date.now();
const nanos = (ms: number) => `${ms}000000`;
/** Signature de l'exception par défaut, telle que l'identité « une panne, une occurrence » la porte. */
const SIGNATURE = JSON.stringify(["ValueError", "montant négatif"]);

const kv = (key: string, value: unknown) => ({
  key,
  value: typeof value === "boolean" ? { boolValue: value }
    : typeof value === "number" ? { intValue: String(value) }
      : { stringValue: String(value) },
});
/** Un attribut `undefined` n'est pas émis : c'est ainsi qu'un test retire un attribut par défaut. */
const attributs = (attrs: Attrs) => Object.entries(attrs).filter(([, value]) => value !== undefined).map(([key, value]) => kv(key, value));

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

  it("une identité par événement : déterministe, distincte par rang, app-scopée, jamais indexée", () => {
    const payload = () => traces([span({}, {}, [evenement(erreur()), evenement(erreur())])]);
    const a = flattenOtlp(payload(), { now: NOW });
    const b = flattenOtlp(payload(), { now: NOW });
    expect(a.errors.map((e: Row) => e.span_id)).toEqual(b.errors.map((e: Row) => e.span_id));
    const [premier, second] = a.errors;
    expect(premier.span_id).toMatch(/^[0-9a-f]{32}$/);
    expect(premier.span_id).not.toBe(second.span_id);
    expect(premier.source_parent_span_id).toBe(SPAN);
    expect(premier.span_id).toBe(exceptionIdentity(APP, ["otel", TRACE, SPAN, SIGNATURE, 0]));
    expect(second.span_id).toBe(exceptionIdentity(APP, ["otel", TRACE, SPAN, SIGNATURE, 1]));
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
      expect(row.span_id).toBe(exceptionIdentity(APP, ["otel", TRACE, SPAN, SIGNATURE, 0]));
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

  // 01/10/2026 : le SDK web porte désormais l'événement OpenTelemetry sur chacune
  // de ses erreurs (packages/rum-sdk/src/otel.ts). Le cas ci-dessus devient le
  // cas NOMINAL du navigateur : on le rejoue sur l'octet que le SDK encode.
  it("le span « exception » tel que l'encode le SDK web : un événement, une seule erreur", () => {
    const attrsWeb = { ...erreur(), "mip.session_id": "s-web", "mip.route": "/payer" };
    const debut = msToHr(NOW - 1_000);
    const ev = evenementException(attrsWeb, debut);
    expect(ev).not.toBeNull();
    const corps = buildResourceSpans({ "mip.app_id": APP, "service.name": "mip-rum-web" }, [{
      name: "exception", traceId: TRACE, spanId: SPAN, startTime: debut, endTime: debut,
      attributes: attrsWeb, events: [ev!],
    }]) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Row[] }> }> };
    const [encode] = corps.resourceSpans[0].scopeSpans[0].spans;
    expect(encode.events).toEqual([{
      timeUnixNano: nanos(NOW - 1_000),
      name: "exception",
      attributes: attributs({
        "exception.type": "ValueError",
        "exception.message": "montant négatif",
        "exception.stacktrace": erreur()["exception.stacktrace"],
      }),
    }]);
    const rows = flattenOtlp(corps, { now: NOW });
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toMatchObject({ span_id: SPAN, session_id: "s-web", error_type: "ValueError" });
    expect(rows.rejected).toBe(0);
  });

  it("sans type ni message, le SDK web n'invente pas d'événement", () => {
    expect(evenementException({ "exception.stacktrace": "pile seule" }, msToHr(NOW))).toBeNull();
    expect(evenementException({ "exception.type": "", "exception.message": "" }, msToHr(NOW))).toBeNull();
  });
});

// 29/09/2026, constaté en production : l'agent Node officiel sous Express 5
// enregistre l'exception sur le span INTERNAL du gestionnaire (qui porte
// `http.route`), pas sur le span SERVER. L'erreur partait avec `route = null`.
describe("parseur — route d'une exception portée par un span non serveur", () => {
  const SPAN_HANDLER = "00f067aa0ba902c7";
  const AUTRE_TRACE = "5bf92f3577b34da6a3ce929d0e0e4736";
  /** Span INTERNAL de l'instrumentation Express : c'est lui qui porte l'exception. */
  const gestionnaire = (attrs: Attrs = { "http.route": "/factures/:id" }, over: Row = {}) => span(
    { spanId: SPAN_HANDLER, parentSpanId: SPAN, kind: 1, name: "request handler - /factures/:id", ...over },
    { "http.request.method": undefined, "http.route": undefined, "express.type": "request_handler", ...attrs },
  );
  /** Span SERVER de la requête, sans exception. */
  const serveur = (attrs: Attrs = {}, over: Row = {}) => span({ name: "GET /factures/:id", ...over },
    { "http.request.method": "GET", "http.route": "/factures/:id", "http.response.status_code": 500, ...attrs }, []);
  const routes = (spans: Row[]) => flattenOtlp(traces(spans), { now: NOW }).errors.map((e: Row) => e.route);

  it("span INTERNAL qui porte `http.route` : sa propre route, normalisée, même seul dans le lot", () => {
    expect(routes([gestionnaire()])).toEqual(["/factures/:id"]);
    expect(routes([gestionnaire({ "http.route": "/factures/{id}" })])).toEqual(["/factures/:id"]);
    // Sa route prime sur celle du serveur, dans les deux ordres du lot.
    expect(routes([gestionnaire(), serveur({ "http.route": "/autre" })])).toEqual(["/factures/:id"]);
    expect(routes([serveur({ "http.route": "/autre" }), gestionnaire()])).toEqual(["/factures/:id"]);
  });

  it("span INTERNAL sans `http.route` : la route du span serveur de sa trace présent dans le lot", () => {
    const sansRoute = gestionnaire({ "http.route": "  " });
    // L'exportateur envoie l'enfant AVANT son parent : il se termine plus tôt.
    expect(routes([sansRoute, serveur()])).toEqual(["/factures/:id"]);
    expect(routes([serveur(), sansRoute])).toEqual(["/factures/:id"]);
    // Un intermédiaire (middleware) entre le porteur et le serveur ne coupe pas la parenté.
    const middleware = span({ spanId: "00f067aa0ba902c8", parentSpanId: SPAN, kind: 1, name: "middleware - query" },
      { "http.request.method": undefined, "http.route": undefined, "express.type": "middleware" }, []);
    expect(routes([gestionnaire({}, { parentSpanId: "00f067aa0ba902c8" }), middleware, serveur()])).toEqual(["/factures/:id"]);
    // Parent absent du lot, un seul span serveur dans la trace : le sien.
    expect(routes([gestionnaire({}, { parentSpanId: "00f067aa0ba902c9" }), serveur()])).toEqual(["/factures/:id"]);
    // Le 404 sans `http.route` du serveur se transmet tel que l'ingestion l'écrit.
    expect(routes([sansRoute, serveur({ "http.route": undefined, "http.response.status_code": 404 })])).toEqual(["(non trouvée)"]);
  });

  it("sans route propre ni serveur de sa trace dans le lot : null, jamais la route d'une autre trace", () => {
    const sansRoute = gestionnaire({});
    expect(routes([sansRoute])).toEqual([null]);
    expect(routes([sansRoute, serveur({}, { traceId: AUTRE_TRACE })])).toEqual([null]);
    // Même trace, autre app : jamais prêtée.
    const autreApp = traces([serveur()], undefined, undefined, "autre-app");
    const lot = traces([sansRoute]);
    expect(flattenOtlp({ resourceSpans: [...autreApp.resourceSpans, ...lot.resourceSpans] }, { now: NOW }).errors
      .map((e: Row) => e.route)).toEqual([null]);
    // Deux serveurs de routes différentes dans la trace, sans parenté lisible : on ne choisit pas.
    const orphelin = gestionnaire({}, { parentSpanId: "00f067aa0ba902c9" });
    expect(routes([orphelin, serveur(), serveur({ "http.route": "/autre" }, { spanId: "00f067aa0ba902ca" })])).toEqual([null]);
  });

  it("non-régression : l'exception du span SERVER garde la route de sa requête", () => {
    expect(routes([span()])).toEqual(["/invoices/:id"]);
    // Sans `http.route`, un 404 garde la route que porte le NOM du span quand c'est un motif
    // de routeur (`POST /invoices/{id}`, cas de Go, otelhttp) ; un nom qui n'est qu'un chemin
    // brut reste « (non trouvée) » (otlp.mjs, motifDuNom).
    expect(routes([span({}, { "http.route": undefined, "http.response.status_code": 404 })])).toEqual(["/invoices/:id"]);
    expect(routes([span({ name: "GET /manager/html" }, { "http.route": undefined, "http.response.status_code": 404 })])).toEqual(["(non trouvée)"]);
    expect(routes([span({}, { "http.response.status_code": 404 })])).toEqual(["/invoices/:id"]);
    // `mip.route` d'un span navigateur (SDK web) prime toujours.
    expect(routes([gestionnaire({ "mip.route": "/page" })])).toEqual(["/page"]);
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
    // Trace et span connus : la clé est celle de l'événement du span porteur.
    expect(parsed.errors[0].span_id).toBe(exceptionIdentity(APP, ["otel", TRACE, SPAN, SIGNATURE, 0]));
    expect(parsed.errors[0].span_id).toBe(flattenOtlp(traces([span()]), { now: NOW }).errors[0].span_id);
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
      // Un span chacun : sur le même, deux logs d'une même exception n'en font qu'une.
      log(erreur(), { severityNumber: undefined, severityText: "FATAL", spanId: "00f067aa0ba902c1" }),
      log(erreur(), { severityNumber: 0, severityText: "error2", spanId: "00f067aa0ba902c2" }),
      log(erreur(), { severityNumber: undefined, severityText: "warning", spanId: "00f067aa0ba902c3" }),
      log(erreur({ "mip.exception_id": ID }), { timeUnixNano: undefined, observedTimeUnixNano: undefined }),
    ]), { now: NOW });
    expect(parsed.errors).toHaveLength(3);
  });

  it("deux logs d'une même exception sur un même span : une ligne ; sans trace ni span, deux", () => {
    const memeSpan = flattenOtlpLogs(logs([log(), log(erreur(), { timeUnixNano: nanos(NOW - 900) })]), { now: NOW });
    expect(memeSpan.logs).toHaveLength(2);
    expect(memeSpan.errors).toHaveLength(1);
    const orphelins = () => logs([log(erreur(), { traceId: undefined, spanId: undefined }), log(erreur(), { traceId: undefined, spanId: undefined })]);
    const a = flattenOtlpLogs(orphelins(), { now: NOW }).errors.map((e: Row) => e.span_id);
    const b = flattenOtlpLogs(orphelins(), { now: NOW }).errors.map((e: Row) => e.span_id);
    expect(new Set(a).size).toBe(2);
    expect(b).toEqual(a); // rejeu du même lot : mêmes clés
  });
});

describe("parseur — une panne, une occurrence (sans mip.exception_id)", () => {
  const SPAN_ENFANT = "00f067aa0ba902b8";

  it("Flask : l'événement du span et deux logs ERROR de la même exception ont UNE clé, quel que soit le lot", () => {
    const parSpan = flattenOtlp(traces([span()]), { now: NOW }).errors;
    const parLogs = flattenOtlpLogs(logs([log(), log(erreur(), { timeUnixNano: nanos(NOW - 800), body: { stringValue: "Exception on /invoices/1 [POST]" } })]), { now: NOW }).errors;
    expect(parSpan).toHaveLength(1);
    expect(parLogs).toHaveLength(1);
    expect(parLogs[0].span_id).toBe(parSpan[0].span_id);
  });

  it("l'exception remontée d'un span enfant se range sur son parent de même signature, dans les deux ordres du lot", () => {
    const enfant = span({ spanId: SPAN_ENFANT, parentSpanId: SPAN, kind: 1, name: "facturer" });
    for (const ordre of [[enfant, span()], [span(), enfant]]) {
      const errors = flattenOtlp(traces(ordre), { now: NOW }).errors;
      expect(errors).toHaveLength(1);
      expect(errors[0].span_id).toBe(exceptionIdentity(APP, ["otel", TRACE, SPAN, SIGNATURE, 0]));
      // La ligne gardée est celle du span serveur : il porte la route de la requête.
      expect(errors[0]).toMatchObject({ source_parent_span_id: SPAN, route: "/invoices/:id" });
    }
    // Et le log émis sur le span parent rejoint la même ligne.
    expect(flattenOtlpLogs(logs([log()]), { now: NOW }).errors[0].span_id)
      .toBe(flattenOtlp(traces([enfant, span()]), { now: NOW }).errors[0].span_id);
  });

  it("restent distinctes : autre message, autre type, autre trace, span sans parenté, parent d'une autre signature", () => {
    const cas: Array<[string, Row[]]> = [
      ["autre message", [span({}, {}, [evenement(erreur()), evenement(erreur({ "exception.message": "montant nul" }))])]],
      ["autre type", [span({}, {}, [evenement(erreur()), evenement(erreur({ "exception.type": "TypeError" }))])]],
      ["autre trace", [span(), span({ traceId: "5bf92f3577b34da6a3ce929d0e0e4736" })]],
      ["frère sans parenté", [span(), span({ spanId: SPAN_ENFANT })]],
      ["parent d'une autre signature", [
        span({ spanId: SPAN_ENFANT, parentSpanId: SPAN, kind: 1 }),
        span({}, {}, [evenement(erreur({ "exception.message": "autre panne" }))]),
      ]],
    ];
    for (const [nom, spans] of cas) {
      expect(flattenOtlp(traces(spans), { now: NOW }).errors, nom).toHaveLength(2);
    }
  });

  it("un log d'une autre signature que l'événement reste une autre occurrence", () => {
    const parSpan = flattenOtlp(traces([span()]), { now: NOW }).errors[0].span_id;
    const parLog = flattenOtlpLogs(logs([log(erreur({ "exception.message": "montant nul" }))]), { now: NOW }).errors[0].span_id;
    expect(parLog).not.toBe(parSpan);
  });

  it("la signature est prise APRÈS normalisation : un secret scrubbé ne distingue pas deux signaux", () => {
    const message = "refusé pour alice@example.test";
    const parSpan = flattenOtlp(traces([span({}, {}, [evenement(erreur({ "exception.message": message }))])]), { now: NOW }).errors[0];
    const parLog = flattenOtlpLogs(logs([log(erreur({ "exception.message": message }))]), { now: NOW }).errors[0];
    expect(parSpan.message).not.toContain("alice@example.test");
    expect(parLog.span_id).toBe(parSpan.span_id);
  });

  it("mip.exception_id garde la main : il n'est jamais fusionné sur la ressemblance", () => {
    const declaree = flattenOtlp(traces([span({}, {}, [evenement(erreur({ "mip.exception_id": ID })), evenement(erreur())])]), { now: NOW }).errors;
    expect(declaree).toHaveLength(2);
    expect(declaree[0].span_id).toBe(exceptionIdentity(APP, ["id", ID]));
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
  events: [], spans: [],
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

// ─────────────────── Agent officiel Python / FastAPI (figé) ───────────────────
//
// Ce que l'agent OpenTelemetry officiel émet pour `GET /boum`, une route FastAPI
// qui lève `KeyError("facture 42")`, appelée avec `traceparent` et `tracestate:
// mip=s:session-web` comme le pose le SDK web. Capturé le 29/09/2026 avec les
// versions de tests/e2e/site-cobaye/requirements.txt (fastapi 0.141.1,
// opentelemetry-instrumentation-fastapi 0.66b0, opentelemetry-sdk 1.45.0),
// encodé par l'encodeur OTLP officiel puis rendu en OTLP/JSON. Figé ici : le
// test ne dépend ni de Python ni d'un paquet installé. Seule retouche : la pile,
// dont les chemins du poste de capture sont remplacés par `/srv/app` et dont les
// cadres intermédiaires (Starlette, FastAPI) sont omis.
//
// À noter pour l'ingestion : conventions HTTP d'avant la stabilisation
// (`http.method`, `http.status_code`), exception sur le span SERVER, et deux
// spans INTERNAL `http send` enfants de la requête.
const FASTAPI_SPAN_SERVEUR = "da56f53337b57b98";
const FASTAPI_RECU_MS = 1790674060300;
const FASTAPI_PILE = [
  "Traceback (most recent call last):",
  '  File "/srv/app/.venv/lib/python3.13/site-packages/opentelemetry/instrumentation/fastapi/__init__.py", line 360, in __call__',
  "    await self.app(scope, receive, send)",
  '  File "/srv/app/.venv/lib/python3.13/site-packages/starlette/middleware/exceptions.py", line 63, in __call__',
  "    await wrap_app_handling_exceptions(self.app, conn)(scope, receive, send)",
  '  File "/srv/app/.venv/lib/python3.13/site-packages/fastapi/routing.py", line 352, in run_endpoint_function',
  "    return await dependant.call(**values)",
  "           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
  '  File "/srv/app/main.py", line 26, in boum',
  '    raise KeyError("facture 42")',
  "KeyError: 'facture 42'",
  "",
].join("\n");

function fastapiOfficiel() {
  const commun = { traceId: TRACE, traceState: "mip=s:session-web" };
  return {
    resourceSpans: [{
      resource: {
        attributes: attributs({
          "telemetry.sdk.language": "python",
          "telemetry.sdk.name": "opentelemetry",
          "telemetry.sdk.version": "1.45.0",
          "service.instance.id": "00000000-0000-4000-8000-000000000000",
          "mip.app_id": APP,
          "service.name": "fastapi",
          "telemetry.auto.version": "0.66b0",
        }),
      },
      scopeSpans: [{
        scope: { name: "opentelemetry.instrumentation.fastapi", version: "0.66b0" },
        spans: [
          {
            ...commun, spanId: "221346c1142bbbda", parentSpanId: FASTAPI_SPAN_SERVEUR, name: "GET /boum http send", kind: 1,
            startTimeUnixNano: "1790674060248650000", endTimeUnixNano: "1790674060248677000",
            attributes: attributs({ "asgi.event.type": "http.response.start", "http.status_code": 500 }),
            status: { code: 2 }, flags: 256,
          },
          {
            ...commun, spanId: "34755bd1359ac17f", parentSpanId: FASTAPI_SPAN_SERVEUR, name: "GET /boum http send", kind: 1,
            startTimeUnixNano: "1790674060248740000", endTimeUnixNano: "1790674060248747000",
            attributes: attributs({ "asgi.event.type": "http.response.body" }),
            status: {}, flags: 256,
          },
          {
            ...commun, spanId: FASTAPI_SPAN_SERVEUR, parentSpanId: SPAN, name: "GET /boum", kind: 2,
            startTimeUnixNano: "1790674060243753000", endTimeUnixNano: "1790674060248761000",
            attributes: attributs({
              "http.scheme": "http",
              "http.host": "127.0.0.1:8001",
              "net.host.port": 8001,
              "http.flavor": "1.1",
              "http.target": "/boum",
              "http.url": "http://127.0.0.1:8001/boum",
              "http.method": "GET",
              "http.server_name": "127.0.0.1:8001",
              "http.user_agent": "Mozilla/5.0",
              "net.peer.ip": "127.0.0.1",
              "net.peer.port": 53124,
              "http.route": "/boum",
              "http.status_code": 500,
            }),
            events: [{
              timeUnixNano: "1790674060248540000",
              name: "exception",
              attributes: attributs({
                "exception.type": "KeyError",
                "exception.message": "'facture 42'",
                "exception.stacktrace": FASTAPI_PILE,
                "exception.escaped": "False",
              }),
            }],
            status: { code: 2 }, flags: 768,
          },
        ],
        schemaUrl: "https://opentelemetry.io/schemas/1.11.0",
      }],
    }],
  };
}

describe("agent officiel Python / FastAPI (charge figée) -> ingestion", () => {
  it("l'exception d'une requête ASGI devient une erreur python rattachée à son span, sans session inventée", () => {
    const rows = flattenOtlp(fastapiOfficiel(), { now: FASTAPI_RECU_MS });
    const serveur = rows.spans.filter((s: Row) => s.tier === "back");
    expect(serveur).toEqual([expect.objectContaining({
      span_id: FASTAPI_SPAN_SERVEUR, trace_id: TRACE, status_code: 500, session_id: "session-web", route: "/boum",
    })]);
    // Les deux `http send` de l'agent restent des spans de détail de la même requête.
    expect(rows.spans.filter((s: Row) => s.tier === "detail").map((s: Row) => s.parent_span_id))
      .toEqual([FASTAPI_SPAN_SERVEUR, FASTAPI_SPAN_SERVEUR]);
    expect(rows.errors).toEqual([expect.objectContaining({
      origin_signal: "span_event", error_source: "python", service: "fastapi", trace_id: TRACE,
      source_parent_span_id: FASTAPI_SPAN_SERVEUR, session_id: null, session_claim: "session-web",
      // L'agent officiel ne déclare ni le caractère géré ni d'identifiant d'exception.
      error_type: "KeyError", message: "'facture 42'", handled: null, route: "/boum", exception_id: null,
    })]);
    expect(rows.errors[0].stack).toContain("Traceback (most recent call last)");
    expect(rows.errors[0].span_id).toBe(exceptionIdentity(APP, [
      "otel", TRACE, FASTAPI_SPAN_SERVEUR, JSON.stringify(["KeyError", "'facture 42'"]), 0,
    ]));
  });
});
