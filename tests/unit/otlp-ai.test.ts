// v0.8 — parsing des spans OTel GenAI (gen_ai.*) -> lignes rum_ai.
import { describe, expect, it } from "vitest";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const sv = (s: string) => ({ stringValue: s });
const iv = (n: number) => ({ intValue: n });

function aiPayload(attrs: unknown[], over: Record<string, unknown> = {}) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "mip.app_id", value: sv("demo") }] },
        scopeSpans: [
          {
            spans: [
              {
                name: "gen_ai",
                spanId: "ai-1",
                traceId: "trace-1",
                startTimeUnixNano: "1000000000",
                endTimeUnixNano: "1420000000", // +420 ms
                attributes: attrs,
                ...over,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("flattenOtlp — gen_ai", () => {
  it("extrait provider/model/tokens/coût/latence/statut", () => {
    const rows = flattenOtlp(
      aiPayload([
        { key: "gen_ai.system", value: sv("openai") },
        { key: "gen_ai.request.model", value: sv("gpt-4o") },
        { key: "gen_ai.operation.name", value: sv("chat") },
        { key: "gen_ai.usage.input_tokens", value: iv(1000) },
        { key: "gen_ai.usage.output_tokens", value: iv(500) },
        { key: "mip.route", value: sv("/api/chat") },
      ]),
    );
    expect(rows.ai).toHaveLength(1);
    const c = rows.ai[0];
    expect(c).toMatchObject({
      span_id: "ai-1",
      trace_id: "trace-1",
      app_id: "demo",
      route: "/api/chat",
      provider: "openai",
      model: "gpt-4o",
      operation: "chat",
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      status: "ok",
      session_id: null,
    });
    expect(c.cost_usd).toBeCloseTo(0.0075, 6);
    expect(c.latency_ms).toBeCloseTo(420, 3);
  });

  it("détecté par attribut même sans nom 'gen_ai' ; coût réel prime", () => {
    const rows = flattenOtlp(
      aiPayload(
        [
          { key: "gen_ai.system", value: sv("openrouter") },
          { key: "gen_ai.request.model", value: sv("x/y") },
          { key: "gen_ai.usage.input_tokens", value: iv(10) },
          { key: "gen_ai.usage.output_tokens", value: iv(10) },
          { key: "gen_ai.usage.cost", value: { doubleValue: 0.0123 } },
        ],
        { name: "chat x/y" },
      ),
    );
    expect(rows.ai).toHaveLength(1);
    expect(rows.ai[0].cost_usd).toBeCloseTo(0.0123, 6); // coût provider, pas estimé
  });

  it("error.type -> status 'error' ; session via tracestate", () => {
    const rows = flattenOtlp(
      aiPayload(
        [
          { key: "gen_ai.system", value: sv("anthropic") },
          { key: "gen_ai.request.model", value: sv("claude-sonnet-4") },
          { key: "error.type", value: sv("RateLimitError") },
        ],
        { traceState: "mip=s:sess-42" },
      ),
    );
    expect(rows.ai[0]).toMatchObject({
      status: "error",
      error_type: "RateLimitError",
      session_id: "sess-42",
    });
  });

  it("sans provider ni model -> rejeté (compté), pas de ligne ai", () => {
    const rows = flattenOtlp(
      aiPayload([{ key: "gen_ai.usage.input_tokens", value: iv(5) }], { name: "gen_ai" }),
    );
    expect(rows.ai).toHaveLength(0);
    expect(rows.rejected).toBe(1);
  });
});
