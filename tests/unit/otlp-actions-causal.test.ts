import { describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { causalActionId, flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const ACTION = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-09-16T08:00:00.000Z");

const kv = (key: string, value: string | number) => ({
  key,
  value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
});

function span(name: string, spanId: string, attrs: Record<string, string | number>) {
  return {
    name,
    spanId,
    traceId: "a".repeat(32),
    startTimeUnixNano: String(BigInt(NOW) * 1_000_000n),
    endTimeUnixNano: String(BigInt(NOW + 20) * 1_000_000n),
    attributes: Object.entries({
      "mip.session_id": "session-actions",
      "mip.route": "/checkout?token=secret",
      ...attrs,
    }).map(([key, value]) => kv(key, value)),
  };
}

function payload(spans: object[]) {
  return {
    resourceSpans: [{
      resource: { attributes: [kv("mip.app_id", "app-actions")] },
      scopeSpans: [{ spans }],
    }],
  };
}

describe("flattenOtlp — actions causales P3", () => {
  it("dual-write la racine scrubbed et propage le même ID aux effets", () => {
    const rows = flattenOtlp(payload([
      span("rum.action", "00000000000000a1", {
        "mip.event_type": "action",
        "mip.event_name": "button alice@example.test",
        "mip.action_type": "click",
        "mip.action_id": ACTION,
        "mip.context": JSON.stringify({ plan: "pro", email: "alice@example.test" }),
      }),
      span("http.client", "00000000000000a2", {
        "mip.action_id": ACTION,
        "mip.trace_id": "b".repeat(32),
        "mip.span_id": "00000000000000b2",
        "http.url": "https://app.test/api/pay?token=secret",
        "http.method": "POST",
        "http.status_code": 200,
        "http.duration_ms": 120,
      }),
      span("resource", "00000000000000a3", {
        "mip.action_id": ACTION,
        "resource.url": "https://app.test/chunk.js?token=secret",
        "resource.type": "script",
        "resource.duration_ms": 45,
      }),
      span("exception", "00000000000000a4", {
        "mip.action_id": ACTION,
        "exception.type": "Error",
        "exception.message": "payment failed for alice@example.test",
      }),
      span("breadcrumb", "00000000000000a5", {
        "mip.action_id": ACTION,
        "breadcrumb.type": "click",
        "breadcrumb.label": "button Payer",
        "breadcrumb.seq": 1,
      }),
      span("frustration", "00000000000000a6", {
        "mip.action_id": ACTION,
        "frustration.kind": "error",
        "frustration.target": "button Payer",
        "frustration.count": 1,
      }),
    ]), { now: NOW });

    expect(rows.actions).toEqual([expect.objectContaining({
      action_id: ACTION,
      type: "click",
      name: "button [email]",
      route: "/checkout",
      context: { plan: "pro", email: "[email]" },
    })]);
    expect(rows.events.find((row: { event_type?: string }) => row.event_type === "action")?.name)
      .toBe("button [email]");
    for (const child of [rows.spans[0], rows.resources[0], rows.errors[0], rows.breadcrumbs[0]]) {
      expect(child.action_id).toBe(ACTION);
    }
    expect(rows.breadcrumbs[0].route).toBe("/checkout");
    expect(rows.events.find((row: { name: string }) => row.name === "frustration.error"))
      .toMatchObject({ action_id: ACTION, props: { target: "button Payer", count: 1 } });
  });

  it("accepte seulement les IDs causaux stricts et rejette error sans racine logique", () => {
    expect(causalActionId(ACTION.toUpperCase())).toBe(ACTION);
    expect(causalActionId("action-1")).toBeNull();
    const rows = flattenOtlp(payload([
      span("rum.action", "00000000000000c1", {
        "mip.event_type": "action", "mip.event_name": "Payer", "mip.action_id": "action-1",
      }),
      span("frustration", "00000000000000c2", {
        "frustration.kind": "error", "frustration.target": "Payer",
      }),
    ]), { now: NOW });
    expect(rows.actions).toEqual([]);
    expect(rows.events).toEqual([]);
    expect(rows.rejected).toBe(2);
  });
});
