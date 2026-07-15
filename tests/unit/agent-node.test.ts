// PR1 — agent Node zéro-config. On vérifie la config par env, le templating de
// route, et surtout le ROUND-TRIP : la charge OTLP produite par l'agent est
// ingérée par flattenOtlp comme un span `back` (http.server) corrélable.
import { describe, expect, it } from "vitest";
import {
  buildConfig,
  buildHttpServerSpan,
  buildPayload,
  normalizeRoute,
  parseTraceparent,
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
