// PR1 — agent Node zéro-config. On vérifie la config par env, le templating de
// route, et surtout le ROUND-TRIP : la charge OTLP produite par l'agent est
// ingérée par flattenOtlp comme un span `back` (http.server) corrélable.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildConfig,
  buildDbSpan,
  buildHttpServerSpan,
  buildLogPayload,
  buildLogRecord,
  buildPayload,
  describeError,
  describeThrown,
  type ExceptionInput,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
  sqlOperation,
} from "../../packages/agent-node/src/core";
import { flattenOtlp, flattenOtlpLogs } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

describe("agent-node — config", () => {
  it("désactivé sans endpoint/app_id", () => {
    expect(buildConfig({}).enabled).toBe(false);
    expect(buildConfig({ MIP_RUM_ENDPOINT: "x" }).enabled).toBe(false);
  });
  it("actif + valeurs par défaut", () => {
    const c = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo" });
    expect(c.enabled).toBe(true);
    expect(c.env).toBe("prod");
    expect(c.service).toBe("backend");
    expect(c.apiKey).toBeNull();
  });
});

describe("agent-node — normalizeRoute", () => {
  it("templatise ids numériques / uuid / hex longs", () => {
    expect(normalizeRoute("/users/42/orders/7")).toBe("/users/:id/orders/:id");
    expect(normalizeRoute("/o/9f1c8e2a4b6d0f3a9f1c8e2a4b6d0f3a")).toBe("/o/:id");
    expect(normalizeRoute("/api/search?q=x")).toBe("/api/search");
  });
});

describe("agent-node — round-trip OTLP -> flattenOtlp (span back)", () => {
  const cfg = buildConfig({
    MIP_RUM_ENDPOINT: "https://i/v1/traces",
    MIP_RUM_APP_ID: "demo",
    MIP_RUM_API_KEY: "mip_key_123",
  });
  const tp = parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")!;
  const span = buildHttpServerSpan({
    traceId: tp.traceId,
    spanId: "00aa11bb22cc33dd",
    parentSpanId: tp.spanId,
    method: "GET",
    route: "/api/search",
    url: null,
    status: 200,
    sessionId: "sess-9",
    startMs: 1_760_000_000_000,
    durationMs: 118,
  });
  const rows = flattenOtlp(buildPayload(cfg, [span]));

  it("est ingéré comme un span serveur (back) corrélé", () => {
    expect(rows.spans).toHaveLength(1);
    const s = rows.spans[0];
    expect(s.tier).toBe("back");
    expect(s.trace_id).toBe(tp.traceId); // corrélation avec le front navigateur
    expect(s.parent_span_id).toBe(tp.spanId);
    expect(s.route).toBe("/api/search");
    expect(s.status_code).toBe(200);
    expect(s.duration_ms).toBe(118);
    expect(s.session_id).toBe("sess-9");
    expect(rows.rejected).toBe(0);
    expect(rows.apiKeys[0]).toEqual({ app_id: "demo", api_key: "mip_key_123" });
  });
});

describe("agent-node — normalizeSql / sqlOperation (profondeur DB #20)", () => {
  it("remplace littéraux chaîne et nombres par ? (cardinalité + anti-PII)", () => {
    expect(normalizeSql("SELECT * FROM users WHERE email = 'a@b.co' AND id = 42")).toBe(
      "SELECT * FROM users WHERE email = ? AND id = ?",
    );
  });
  it("extrait le verbe SQL en tête", () => {
    expect(sqlOperation("  select 1")).toBe("SELECT");
    expect(sqlOperation("INSERT INTO t values (1)")).toBe("INSERT");
    expect(sqlOperation("vacuum analyze")).toBeNull();
  });
});

describe("agent-node — round-trip DB span (tier detail/db) enfant du http.server", () => {
  const cfg = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo" });
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const httpSpanId = "00aa11bb22cc33dd";
  const http = buildHttpServerSpan({
    traceId,
    spanId: httpSpanId,
    parentSpanId: null,
    method: "GET",
    route: "/api/x",
    url: null,
    status: 200,
    sessionId: null,
    startMs: 1_760_000_000_000,
    durationMs: 50,
  });
  const db = buildDbSpan({
    traceId,
    spanId: "dddd1111eeee2222",
    parentSpanId: httpSpanId,
    system: "postgresql",
    statement: "SELECT * FROM users WHERE id = ?",
    operation: "SELECT",
    startMs: 1_760_000_000_010,
    durationMs: 7,
  });
  const rows = flattenOtlp(buildPayload(cfg, [http, db]));

  it("produit un span detail/db corrélé au http.server parent", () => {
    expect(rows.rejected).toBe(0);
    const dbRow = rows.spans.find((s: { tier: string }) => s.tier === "detail");
    expect(dbRow).toBeTruthy();
    expect(dbRow.kind).toBe("db");
    expect(dbRow.trace_id).toBe(traceId);
    expect(dbRow.parent_span_id).toBe(httpSpanId); // enfant du http.server
    expect(dbRow.method).toBe("SELECT");
    expect(dbRow.route).toBe("postgresql");
    expect(dbRow.name).toContain("SELECT * FROM users");
    expect(dbRow.duration_ms).toBe(7);
    expect(dbRow.session_id).toBeNull(); // spans back "detail" ne portent pas de session
  });
});

// ─────────────────────────── P5.3 : exceptions ───────────────────────────────

describe("agent-node — extraction d'une Error", () => {
  it("garde type, message et STACK, y compris pour une Error d'un autre realm", () => {
    const locale = describeError(new TypeError("total indéfini"));
    expect(locale).toMatchObject({ type: "TypeError", message: "total indéfini" });
    expect(locale?.stack).toContain("TypeError: total indéfini");
    // `instanceof Error` est faux ici : c'est ce qui faisait sérialiser `{}`.
    const autreRealm = runInNewContext("new RangeError('hors limites')");
    expect(autreRealm instanceof Error).toBe(false);
    expect(describeError(autreRealm)).toMatchObject({ type: "RangeError", message: "hors limites" });
    class PaiementRefuse extends Error {
      name = "PaiementRefuse";
    }
    expect(describeError(new PaiementRefuse("carte"))?.type).toBe("PaiementRefuse");
  });

  it("accepte une valeur qui a message et stack, refuse le reste, ne lève jamais", () => {
    expect(describeError({ message: "m", stack: "Error: m\n    at f (a.js:1:1)" })).toMatchObject({ type: "Object", message: "m" });
    for (const valeur of [null, undefined, "texte", 42, { message: "sans stack" }, [1, 2]]) {
      expect(describeError(valeur)).toBeNull();
    }
    const hostile = new Error("x");
    Object.defineProperty(hostile, "name", { get() { throw new Error("piège"); } });
    Object.defineProperty(hostile, "stack", { get() { throw new Error("piège"); } });
    expect(describeError(hostile)).toEqual({ type: "Error", message: "x", stack: null });
  });

  it("borne ce qui part, largement au-dessus de ce que l'ingestion garde", () => {
    const e = new Error("m".repeat(20_000));
    e.stack = "s".repeat(40_000);
    expect(describeError(e)).toMatchObject({ message: "m".repeat(8_000), stack: "s".repeat(16_000) });
  });

  it("une valeur levée qui n'est pas une Error garde son texte, sans type ni stack inventés", () => {
    expect(describeThrown("boom")).toEqual({ type: null, message: "boom", stack: null });
    expect(describeThrown({ code: 42 })).toEqual({ type: null, message: '{"code":42}', stack: null });
    expect(describeThrown(undefined)).toEqual({ type: null, message: "undefined", stack: null });
    expect(describeThrown(10n)).toEqual({ type: null, message: "valeur illisible", stack: null });
  });
});

describe("agent-node — exceptions en span et en log, round-trip ingestion", () => {
  const cfg = buildConfig({ MIP_RUM_ENDPOINT: "https://i/v1/traces", MIP_RUM_APP_ID: "demo", MIP_RUM_SERVICE: "api" });
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const spanId = "00aa11bb22cc33dd";
  const exception: ExceptionInput = {
    error: { type: "TypeError", message: "total indéfini", stack: "TypeError: total indéfini\n    at payer (/srv/app.js:10:5)" },
    tsMs: Date.now() - 1_000,
    exceptionId: "0123456789abcdef0123456789abcdef",
    handled: false,
    fatal: true,
  };
  const span = buildHttpServerSpan({
    traceId, spanId, parentSpanId: null, method: "POST", route: "/api/pay", url: null,
    status: null, sessionId: null, startMs: Date.now() - 2_000, durationMs: 5, exceptions: [exception],
  });

  it("le span porte l'événement `exception`, le statut ERROR et `error.type`, sans statut HTTP inventé", () => {
    expect(span.status).toEqual({ code: 2 });
    const events = span.events as Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }>;
    expect(events.map((e) => e.name)).toEqual(["exception"]);
    const attrs = Object.fromEntries(events[0].attributes.map((a) => [a.key, a.value]));
    expect(attrs).toEqual({
      "exception.type": { stringValue: "TypeError" },
      "exception.message": { stringValue: "total indéfini" },
      "exception.stacktrace": { stringValue: exception.error.stack },
      "mip.exception_id": { stringValue: exception.exceptionId },
      "mip.error_handled": { boolValue: false },
      "mip.error_fatal": { boolValue: true },
    });
    const keys = (span.attributes as Array<{ key: string }>).map((a) => a.key);
    expect(keys).toContain("error.type");
    expect(keys).not.toContain("http.status_code");
  });

  it("sans exception, le span reste celui d'avant P5.3", () => {
    const ordinaire = buildHttpServerSpan({
      traceId, spanId, parentSpanId: null, method: "GET", route: "/", url: null,
      status: 200, sessionId: null, startMs: Date.now(), durationMs: 1,
    });
    expect(ordinaire.status).toEqual({ code: 1 });
    expect(ordinaire).not.toHaveProperty("events");
    expect((ordinaire.attributes as Array<{ key: string }>).map((a) => a.key)).not.toContain("error.type");
  });

  it("span et log de la même Error : deux lignes dérivées, une seule identité", () => {
    const traces = flattenOtlp(buildPayload(cfg, [span]));
    const logs = flattenOtlpLogs(buildLogPayload(cfg, [buildLogRecord({
      level: "error", body: "TypeError: total indéfini", tsMs: Date.now(), traceId, spanId,
      sessionId: null, route: "/api/pay", exception,
    })]));
    expect(traces.spans).toHaveLength(1);
    expect(traces.errors).toHaveLength(1);
    expect(logs.errors).toHaveLength(1);
    expect(traces.errors[0]).toMatchObject({
      origin_signal: "span_event", error_source: "node", service: "api", env: "prod",
      trace_id: traceId, source_parent_span_id: spanId, handled: false, is_fatal: true,
      exception_id: exception.exceptionId, session_id: null, route: "/api/pay",
    });
    expect(logs.errors[0]).toMatchObject({ origin_signal: "log", error_source: "node", trace_id: traceId });
    expect(logs.errors[0].span_id).toBe(traces.errors[0].span_id);
  });

  it("un log sans exception reste un log, même en ERROR", () => {
    const logs = flattenOtlpLogs(buildLogPayload(cfg, [buildLogRecord({
      level: "error", body: "paiement refusé", tsMs: Date.now(), traceId, spanId, sessionId: null, route: null,
    })]));
    expect(logs.logs).toHaveLength(1);
    expect(logs.errors).toEqual([]);
  });
});
