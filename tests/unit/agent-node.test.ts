// PR1 — agent Node zéro-config. On vérifie la config par env, le templating de
// route, et surtout le ROUND-TRIP : la charge OTLP produite par l'agent est
// ingérée par flattenOtlp comme un span `back` (http.server) corrélable.
import { describe, expect, it } from "vitest";
import {
  buildConfig,
  buildDbSpan,
  buildHttpServerSpan,
  buildPayload,
  normalizeRoute,
  normalizeSql,
  parseTraceparent,
  sqlOperation,
} from "../../packages/agent-node/src/core";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

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
