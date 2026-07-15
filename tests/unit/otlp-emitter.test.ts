// Chantier A — verrou du contrat émetteur SDK <-> ingestion. Avant, la forme
// OTLP était garantie implicitement par le SDK @opentelemetry ; celui-ci ayant
// été remplacé par un émetteur maison (otlp-encode.ts), on prouve ici que sa
// sortie est parsée correctement par flattenOtlp — round-trip sur tous les
// grands types de spans. C'est ce test qui remplace la confiance « OTel ».
import { describe, expect, it } from "vitest";
import {
  buildResourceSpans,
  type EmitSpan,
  hrToNanos,
  msToHr,
  toAnyValue,
} from "../../packages/rum-sdk/src/otlp-encode";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const resourceAttrs = {
  "service.name": "mip-rum-web",
  "mip.app_id": "demo",
  "mip.client_id": "acme",
  "mip.api_key": "mip_secretkey1234",
  "mip.user_agent": "Mozilla/5.0 Test",
  "mip.release": "1.4.2",
};

const span = (name: string, ms: number, attributes: Record<string, unknown>, i: number): EmitSpan => ({
  name,
  traceId: "a".repeat(32),
  spanId: (i + 1).toString(16).padStart(16, "0"),
  startTime: msToHr(ms),
  endTime: msToHr(ms),
  attributes,
});

describe("otlp-encode — round-trip émetteur SDK -> flattenOtlp", () => {
  const spans: EmitSpan[] = [
    span("pageview", 1_760_000_000_000, {
      "mip.session_id": "sess-1",
      "mip.route": "/home",
      "mip.url": "https://app.demo.fr/home",
      "mip.nav_type": "navigate",
      "mip.tz": "Europe/Paris",
      "mip.device_type": "desktop",
    }, 0),
    span("webvital.LCP", 1_760_000_001_000, {
      "mip.session_id": "sess-1",
      "mip.route": "/home",
      "webvital.name": "LCP",
      "webvital.value": 2340.5,
    }, 1),
    span("exception", 1_760_000_002_000, {
      "mip.session_id": "sess-1",
      "exception.type": "TypeError",
      "exception.message": "login failed for jean@client.fr password=hunter2",
      "mip.error_lineno": 42,
    }, 2),
    span("http.client", 1_760_000_003_000, {
      "mip.session_id": "sess-1",
      "mip.trace_id": "deadbeefdeadbeefdeadbeefdeadbeef",
      "mip.span_id": "0011223344556677",
      "mip.route": "/api/search",
      "http.url": "https://api.demo.fr/search",
      "http.method": "GET",
      "http.status_code": 200,
      "http.duration_ms": 42.5,
    }, 3),
    span("track.signup", 1_760_000_004_000, {
      "mip.session_id": "sess-1",
      "mip.props": JSON.stringify({ email: "a@b.fr", plan: "pro" }),
    }, 4),
  ];

  const rows = flattenOtlp(buildResourceSpans(resourceAttrs, spans));

  it("parse chaque type de ligne", () => {
    expect(rows.sessions).toHaveLength(1);
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.metrics).toHaveLength(1);
    expect(rows.errors).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
    expect(rows.spans).toHaveLength(1);
    expect(rows.rejected).toBe(0);
    expect(rows.apiKeys[0]).toEqual({ app_id: "demo", api_key: "mip_secretkey1234" });
  });

  it("préserve les valeurs numériques (int & double)", () => {
    expect(rows.metrics[0].name).toBe("LCP");
    expect(rows.metrics[0].value).toBe(2340.5); // doubleValue
    expect(rows.spans[0].tier).toBe("front"); // http.client
    expect(rows.spans[0].status_code).toBe(200); // intValue -> number
    expect(rows.spans[0].duration_ms).toBe(42.5);
  });

  it("laisse l'ingestion appliquer le scrub PII + le release", () => {
    expect(rows.errors[0].message).toBe("login failed for [email] password=[redacted]");
    expect(rows.errors[0].release).toBe("1.4.2");
    expect(rows.events[0].props).toEqual({ email: "[redacted]", plan: "pro" });
  });
});

describe("otlp-encode — encodage AnyValue & timestamps", () => {
  it("type chaque valeur selon le contrat", () => {
    expect(toAnyValue("x")).toEqual({ stringValue: "x" });
    expect(toAnyValue(200)).toEqual({ intValue: "200" });
    expect(toAnyValue(2340.5)).toEqual({ doubleValue: 2340.5 });
    expect(toAnyValue(true)).toEqual({ boolValue: true });
  });
  it("sérialise le temps en nanosecondes (chaîne, précision préservée)", () => {
    expect(hrToNanos(msToHr(1_760_000_000_000))).toBe("1760000000000000000");
    expect(hrToNanos([1, 0])).toBe("1000000000");
  });
});
