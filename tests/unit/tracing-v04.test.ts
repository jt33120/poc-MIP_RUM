// v0.4 tracing distribué — logique pure : cibles de propagation (SDK),
// format traceparent, et extraction des spans http.client / http.server (parser).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveTarget,
  traceparent,
  type ApiSpanOptions,
} from "../../packages/rum-sdk/src/apispans";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

describe("resolveTarget — qui instrumente-t-on ?", () => {
  beforeEach(() => {
    vi.stubGlobal("location", {
      href: "https://plateforme.groupement-it.com/dashboard",
      origin: "https://plateforme.groupement-it.com",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const opts: ApiSpanOptions = {
    extraOrigins: ["http://localhost:8001"],
    denyOrigins: ["https://xxx.supabase.co"],
    sessionId: "s-1",
  };

  it("same-origin relatif (axios baseURL '/api') -> instrumenté", () => {
    expect(resolveTarget("/api/aos", opts)).toBe(
      "https://plateforme.groupement-it.com/api/aos",
    );
  });
  it("same-origin absolu -> instrumenté", () => {
    expect(
      resolveTarget("https://plateforme.groupement-it.com/api/consultants?x=1", opts),
    ).toContain("/api/consultants");
  });
  it("origin de la liste trace -> instrumenté", () => {
    expect(resolveTarget("http://localhost:8001/api/demo/items/42", opts)).toBe(
      "http://localhost:8001/api/demo/items/42",
    );
  });
  it("cross-origin hors liste (tiers) -> ignoré", () => {
    expect(resolveTarget("https://api.tiers.com/data", opts)).toBeNull();
  });
  it("ingestion MIP (denyOrigins) -> jamais instrumenté (pas de boucle)", () => {
    expect(resolveTarget("https://xxx.supabase.co/functions/v1/v1-traces", opts)).toBeNull();
  });
  it("URL invalide ou non-http -> ignoré", () => {
    expect(resolveTarget("data:text/plain,x", opts)).toBeNull();
  });
});

describe("traceparent — format W3C", () => {
  it("00-<32 hex>-<16 hex>-01", () => {
    const tp = traceparent("ab".repeat(16), "cd".repeat(8));
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

// --- parser ----------------------------------------------------------------------
const SID = "11111111-2222-3333-4444-555555555555";

function payload(spans: object[], resAttrs: object[] = []) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "mip.app_id", value: { stringValue: "demo-app" } },
            ...resAttrs,
          ],
        },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

const frontSpan = {
  spanId: "f1f1f1f1f1f1f1f1",
  startTimeUnixNano: "1760000000000000000",
  name: "http.client",
  attributes: [
    { key: "mip.session_id", value: { stringValue: SID } },
    { key: "mip.trace_id", value: { stringValue: "ab".repeat(16) } },
    { key: "mip.span_id", value: { stringValue: "cd".repeat(8) } },
    { key: "mip.route", value: { stringValue: "/dashboard" } },
    { key: "http.url", value: { stringValue: "https://x.fr/api/aos" } },
    { key: "http.method", value: { stringValue: "GET" } },
    { key: "http.status_code", value: { intValue: 200 } },
    { key: "http.duration_ms", value: { intValue: 320 } },
  ],
};

const backSpan = {
  spanId: "b2b2b2b2b2b2b2b2",
  startTimeUnixNano: "1760000000100000000",
  name: "http.server",
  attributes: [
    { key: "mip.trace_id", value: { stringValue: "ab".repeat(16) } },
    { key: "mip.span_id", value: { stringValue: "ef".repeat(8) } },
    { key: "mip.parent_span_id", value: { stringValue: "cd".repeat(8) } },
    { key: "mip.route", value: { stringValue: "/aos/{ao_id}" } },
    { key: "http.url", value: { stringValue: "/aos/12" } },
    { key: "http.method", value: { stringValue: "GET" } },
    { key: "http.status_code", value: { intValue: 200 } },
    { key: "http.duration_ms", value: { doubleValue: 211.4 } },
  ],
};

describe("flattenOtlp — spans v0.4", () => {
  it("http.client -> tier front, session liée, trace_id des attributs", () => {
    const rows = flattenOtlp(payload([frontSpan]));
    expect(rows.spans).toHaveLength(1);
    const s = rows.spans[0];
    expect(s.tier).toBe("front");
    expect(s.trace_id).toBe("ab".repeat(16));
    expect(s.span_id).toBe("cd".repeat(8));
    expect(s.session_id).toBe(SID);
    expect(s.duration_ms).toBe(320);
    expect(rows.sessions).toHaveLength(1); // l'appel API maintient la session
  });

  it("http.server -> tier back, SANS session requise, AUCUN upsert session", () => {
    const rows = flattenOtlp(payload([backSpan]));
    expect(rows.spans).toHaveLength(1);
    const s = rows.spans[0];
    expect(s.tier).toBe("back");
    expect(s.session_id).toBeNull();
    expect(s.parent_span_id).toBe("cd".repeat(8));
    expect(s.route).toBe("/aos/{ao_id}");
    expect(rows.sessions).toHaveLength(0); // le back ne crée jamais de session
    expect(rows.rejected).toBe(0);
  });

  it("http.server avec session (tracestate mip) -> session posée mais pas upsertée", () => {
    const withSid = {
      ...backSpan,
      attributes: [
        ...backSpan.attributes,
        { key: "mip.session_id", value: { stringValue: SID } },
      ],
    };
    const rows = flattenOtlp(payload([withSid]));
    expect(rows.spans[0].session_id).toBe(SID);
    expect(rows.sessions).toHaveLength(0);
  });

  it("span sans trace_id -> rejeté (compté)", () => {
    const bad = { ...backSpan, attributes: backSpan.attributes.slice(1) };
    const rows = flattenOtlp(payload([bad]));
    expect(rows.spans).toHaveLength(0);
    expect(rows.rejected).toBe(1);
  });

  it("les deux tiers d'une même trace partagent trace_id (jointure possible)", () => {
    const rows = flattenOtlp(payload([frontSpan, backSpan]));
    expect(rows.spans).toHaveLength(2);
    expect(rows.spans[0].trace_id).toBe(rows.spans[1].trace_id);
  });
});
