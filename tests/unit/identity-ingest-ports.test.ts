import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queries, errors, testPool } = vi.hoisted(() => {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const errors: unknown[] = [];
  const optional: Record<string, string[]> = {
    rum_session: ["collection_source", "release", "net_type", "visitor_id", "sample_rate", "error_sample_rate", "has_error", "user_id_hash", "account_id_hash", "context"],
    rum_error: ["occurrences"],
    rum_longtask: ["source", "blocking_ms", "render_ms", "script_url", "script_function", "script_ms", "invoker"],
    rum_event: ["event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name", "action_id", "timing_ms", "feature_flag_value"],
    rum_event_index: ["source_span_id", "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name", "action_id", "timing_ms", "feature_flag_value"],
  };
  const query = async (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    if (text.includes("information_schema.columns")) {
      return { rows: (optional[String(params?.[0])] ?? []).map((column_name) => ({ column_name })) };
    }
    if (text.includes("app_registry")) return { rows: [] };
    if (text.includes("rate_check")) return { rows: [{ ok: true }] };
    return { rows: [] };
  };
  const client = { query, release() {} };
  return { queries, errors, testPool: { query, connect: async () => client } };
});

vi.mock("@/lib/db", () => ({ pool: testPool }));
vi.mock("@/lib/ingest", () => ({
  corsFor: async () => ({}),
  guardApps: async () => null,
  json: (body: unknown, status: number, headers: Record<string, string>) =>
    new Response(JSON.stringify(body), { status, headers }),
  log: { info() {}, warn() {}, error(...args: unknown[]) { errors.push(args); } },
}));

import { POST } from "../../apps/console/app/api/ingest/v1/traces/route";
// @ts-expect-error module JS partagé sans déclarations
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";

const RAW = "alice@example.test";
const SECRET = "identity-port-test-secret";

function payload() {
  const nowNanos = BigInt(Date.now()) * 1_000_000n;
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  return {
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", "identity-port-app")] },
      scopeSpans: [{ spans: [{
        name: "rum.action",
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        startTimeUnixNano: nowNanos.toString(),
        endTimeUnixNano: nowNanos.toString(),
        attributes: [
          attr("mip.session_id", "identity-port-session"),
          attr("mip.event_type", "action"),
          attr("mip.event_name", "checkout"),
          attr("mip.action_id", "identity-port-action"),
          attr("mip.identity.user_id", RAW),
        ],
      }] }],
    }],
  };
}

function assertSecured(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW);
  expect(serialized).not.toContain("mip.identity.user_id");
  expect(serialized).toContain("user_id_hash");
  expect(serialized).toMatch(/[0-9a-f]{64}/);
}

afterEach(() => {
  queries.length = 0;
  errors.length = 0;
  delete process.env.IDENTITY_HASH_SECRET;
});

describe("identité aux deux ports d'ingestion actifs", () => {
  it("sécurise le brut dans la route Next avant writeRows", async () => {
    process.env.IDENTITY_HASH_SECRET = SECRET;
    const response = await POST(new Request("http://console.test/api/ingest/v1/traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    }));
    expect(response.status, JSON.stringify(errors)).toBe(200);
    assertSecured(queries);
  });

  it("sécurise le brut dans le receveur Node avant writeRows", async () => {
    const { handler } = creerReceveur(testPool, {
      identityHashSecret: SECRET,
      requireApiKey: false,
      log: { info() {}, warn() {}, error(...args: unknown[]) { errors.push(args); } },
    });
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("port de test indisponible");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      });
      expect(response.status, JSON.stringify(errors)).toBe(200);
      assertSecured(queries);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
