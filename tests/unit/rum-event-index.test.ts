// P1 — la projection est construite depuis les collections déjà normalisées,
// et non depuis le payload OTLP brut. Ces tests verrouillent sa forme minimale.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundedEventProps, flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import {
  EVENT_INDEX_KINDS,
  EVENT_INDEX_MAX_OFFSET,
  encodeEventCursor,
  parseEventAttribute,
  parseEventCursor,
  parseEventKind,
  parseEventName,
  parseEventPage,
} from "../../apps/console/lib/queries-events";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/otlp-snapshot.json"), "utf8"),
);

function fixtureAvecIdsNatifs() {
  const payload = JSON.parse(JSON.stringify(fixture));
  let n = 1;
  for (const resourceSpan of payload.resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const id = (n++).toString(16).padStart(16, "0");
        span.spanId = id;
        for (const attr of span.attributes ?? []) {
          if (attr.key === "mip.span_id") attr.value = { stringValue: id };
        }
      }
    }
  }
  return payload;
}

describe("flattenOtlp — rum_event_index", () => {
  it("borne les props avant persistance et facettage", () => {
    const props = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key_${i}`, "x".repeat(800)]));
    const bounded = boundedEventProps(props) as Record<string, string>;
    expect(Object.keys(bounded).length).toBeLessThanOrEqual(64);
    expect(Object.values(bounded).every((value) => value.length <= 500)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).length).toBeLessThanOrEqual(12 * 1024);
  });

  it("applique le bornage dans le vrai chemin flattenOtlp avant écriture", () => {
    const stringValue = (value: string) => ({ stringValue: value });
    const huge = Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [
      i === 0 ? "token" : `key_${i}`,
      i === 0 ? "sk-live-super-secret" : `jane${i}@example.test-${"x".repeat(700)}`,
    ]));
    const rows = flattenOtlp({
      resourceSpans: [{
        resource: { attributes: [{ key: "mip.app_id", value: stringValue("safe-app") }] },
        scopeSpans: [{ spans: [{
          name: "track.checkout",
          spanId: "00000000000068ff",
          startTimeUnixNano: "1760000000000000000",
          attributes: [
            { key: "mip.session_id", value: stringValue("session-safe") },
            { key: "mip.route", value: stringValue("/checkout") },
            { key: "mip.props", value: stringValue(JSON.stringify(huge)) },
          ],
        }] }],
      }],
    });
    expect(rows.events).toHaveLength(1);
    const persisted = rows.events[0].props as Record<string, unknown>;
    expect(new TextEncoder().encode(JSON.stringify(persisted)).length).toBeLessThanOrEqual(12 * 1024);
    expect(persisted.token == null || persisted.token === "[redacted]").toBe(true);
    expect(JSON.stringify(persisted)).not.toContain("example.test");
  });

  it("projette chaque collection RUM reconnue avec sa seule identité native", () => {
    const rows = flattenOtlp(fixtureAvecIdsNatifs(), { now: Date.parse("2025-10-09T09:00:00Z") });
    const sourceCount = rows.pageviews.length + rows.metrics.length + rows.errors.length +
      rows.resources.length + rows.longtasks.length + rows.breadcrumbs.length +
      rows.events.length + rows.spans.length;
    expect(rows.eventIndex).toHaveLength(sourceCount);
    expect(new Set(rows.eventIndex.map((e) => `${e.app_id}:${e.kind}:${e.source_span_id}`)).size).toBe(sourceCount);
    expect(new Set(rows.eventIndex.map((e) => e.kind))).toEqual(new Set(EVENT_INDEX_KINDS));
    for (const event of rows.eventIndex) {
      // P6.1 : la release déclarée par la resource (mip.release) suit chaque ligne
      // source ; la fixture ne déclare ni environnement ni service.
      expect(Object.keys(event).sort()).toEqual([
        "app_id", "kind", "release", "route", "session_id", "source_name", "source_span_id", "ts",
      ]);
      expect(event.release).toBe("1.4.2");
      expect(event.source_span_id).toBeTruthy();
    }
  });

  it("ne recopie ni identités, ni textes d'erreur, ni props, et re-scrubbe route/label", () => {
    const stringValue = (value: string) => ({ stringValue: value });
    const rows = flattenOtlp({
      resourceSpans: [{
        resource: { attributes: [{ key: "mip.app_id", value: stringValue("safe-app") }] },
        scopeSpans: [{ spans: [{
          name: "track.customer jane@example.test",
          spanId: "00000000000000e1",
          startTimeUnixNano: "1760000000000000000",
          attributes: [
            { key: "mip.session_id", value: stringValue("session-safe") },
            { key: "mip.route", value: stringValue("/account?email=jane@example.test") },
            { key: "mip.props", value: stringValue('{"token":"sk-live-secret","email":"jane@example.test"}') },
          ],
        }] }],
      }],
    });
    expect(rows.eventIndex).toEqual([{
      app_id: "safe-app",
      session_id: "session-safe",
      ts: expect.any(Date),
      route: "/account",
      kind: "event",
      source_name: "track",
      source_span_id: "00000000000000e1",
    }]);
    const serialized = JSON.stringify(rows.eventIndex);
    expect(serialized).not.toContain("jane@example.test");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("props");
    expect(serialized).not.toContain("visitor_id");
    expect(serialized).not.toContain("user_hash");
  });

  it("ne crée pas de projection pour un signal sans span_id ou un type ignoré", () => {
    const stringValue = (value: string) => ({ stringValue: value });
    const rows = flattenOtlp({
      resourceSpans: [{
        resource: { attributes: [{ key: "mip.app_id", value: stringValue("safe-app") }] },
        scopeSpans: [{ spans: [
          {
            name: "pageview",
            attributes: [{ key: "mip.session_id", value: stringValue("s") }],
          },
          {
            name: "unknown.signal",
            spanId: "ignored-native-id",
            attributes: [{ key: "mip.session_id", value: stringValue("s") }],
          },
        ] }],
      }],
    });
    expect(rows.pageviews).toHaveLength(1); // le comportement source ne change pas
    expect(rows.eventIndex).toEqual([]);
  });

  it("écarte span_id, route et libellé hostiles sans les exposer", () => {
    const stringValue = (value: string) => ({ stringValue: value });
    const rows = flattenOtlp({
      resourceSpans: [{
        resource: { attributes: [{ key: "mip.app_id", value: stringValue("safe-app") }] },
        scopeSpans: [{ spans: [{
          name: "track.customer jane@example.test",
          spanId: "hostile-span-id-jane@example.test",
          startTimeUnixNano: "1760000000000000000",
          attributes: [
            { key: "mip.session_id", value: stringValue("session-safe") },
            { key: "mip.route", value: stringValue("https://evil.test/account?email=jane@example.test") },
          ],
        }] }],
      }],
    });
    expect(rows.events).toHaveLength(1); // la source conserve son comportement
    expect(rows.eventIndex).toEqual([]);
    expect(JSON.stringify(rows.eventIndex)).not.toContain("jane@example.test");
  });
});

describe("contrat de lecture v1 de rum_event_index", () => {
  it("accepte seulement les kinds fermés et refuse les valeurs hostiles", () => {
    expect(parseEventKind(null)).toBeNull();
    expect(parseEventKind("vital")).toBe("vital");
    expect(parseEventKind("logs")).toBeUndefined();
    expect(parseEventKind("error; drop table rum_event_index")).toBeUndefined();
  });

  it("borne un offset hostile sans élargir la liste", () => {
    expect(parseEventPage(new URLSearchParams("limit=9999&offset=999999999"))).toEqual({
      limit: 200,
      offset: EVENT_INDEX_MAX_OFFSET,
    });
  });

  it("parse une égalité primitive top-level et refuse JSONPath/type/taille hostiles", () => {
    expect(parseEventAttribute(new URLSearchParams("attr_source=props&attr_key=plan&attr_type=string&attr_value=pro"))).toEqual({
      source: "props", key: "plan", type: "string", value: "pro",
    });
    expect(parseEventAttribute(new URLSearchParams("attr_source=context&attr_key=score&attr_type=number&attr_value=2.5"))).toMatchObject({ value: 2.5 });
    expect(parseEventAttribute(new URLSearchParams("attr_source=props&attr_key=enabled&attr_type=boolean&attr_value=true"))).toMatchObject({ value: true });
    expect(parseEventAttribute(new URLSearchParams("attr_source=props&attr_key=enabled&attr_type=boolean&attr_value=false"))).toMatchObject({ value: false });
    expect(parseEventAttribute(new URLSearchParams("attr_source=context&attr_key=campaign&attr_type=null"))).toMatchObject({ value: null });
    expect(parseEventAttribute(new URLSearchParams("attr_source=props&attr_key=enabled&attr_type=boolean&attr_value=yes"))).toBeUndefined();
    expect(parseEventAttribute(new URLSearchParams("attr_source=props&attr_key=$.secret&attr_type=string&attr_value=x"))).toBeUndefined();
    expect(parseEventAttribute(new URLSearchParams(`attr_source=props&attr_key=plan&attr_type=string&attr_value=${"x".repeat(501)}`))).toBeUndefined();
    expect(parseEventName("checkout")).toBe("checkout");
    expect(parseEventName("x".repeat(101))).toBeUndefined();
  });

  it("encode un curseur opaque (ts,id) et refuse un curseur modifié", () => {
    const cursor = encodeEventCursor({ ts: new Date("2026-09-16T10:00:00Z"), id: "9007199254740993" });
    expect(parseEventCursor(cursor)).toEqual({ ts: "2026-09-16T10:00:00.000Z", id: "9007199254740993" });
    expect(parseEventCursor("%%%sql%%%")).toBeUndefined();
    expect(parseEventCursor(Buffer.from(JSON.stringify(["bad-date", "1"])).toString("base64url"))).toBeUndefined();
    expect(parseEventCursor(Buffer.from(JSON.stringify(["2026-09-16T10:00:00Z", "9".repeat(40)])).toString("base64url"))).toBeUndefined();
    expect(parseEventCursor(Buffer.from(JSON.stringify(["2026-09-16T10:00:00Z", "9223372036854775808"])).toString("base64url"))).toBeUndefined();
  });

  it("préserve les microsecondes PostgreSQL nécessaires aux égalités de timestamp", () => {
    const cursor = encodeEventCursor({
      ts: new Date("2026-09-16T10:00:00.123Z"),
      cursor_ts: "2026-09-16T10:00:00.123456Z",
      id: "42",
    });
    expect(parseEventCursor(cursor)).toEqual({ ts: "2026-09-16T10:00:00.123456Z", id: "42" });
  });
});
