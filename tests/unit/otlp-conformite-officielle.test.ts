// Conformité de l'émetteur OTLP du SDK web à OpenTelemetry (ADR-0016, « À faire » H14).
//
// otlp-emitter.test.ts relit la sortie du SDK avec le décodeur de MIP : si les deux
// se trompaient de la même façon, il passerait. Ici, la référence est EXTÉRIEURE à
// MIP : le sérialiseur officiel d'OpenTelemetry (`@opentelemetry/otlp-transformer`,
// celui qu'emploient les exportateurs officiels). Pour les mêmes spans, le SDK et
// l'officiel doivent produire le même message OTLP, champ par champ, selon les
// règles du JSON de protobuf : un champ absent vaut sa valeur par défaut, un int64
// s'écrit en nombre ou en chaîne.
//
// Le second contrôle extérieur, le collecteur OpenTelemetry officiel qui reçoit la
// sortie du SDK, est scripts/ci/otlp-collecteur-officiel.mjs.
import { JsonTraceSerializer, ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { describe, expect, it } from "vitest";
import { buildResourceSpans, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import { canonique, RESSOURCE, SCOPE, SPANS, T0 } from "../fixtures/lot-sdk-otlp";
import { decoderTracesProtobuf } from "../../packages/backend/shared/otlp-protobuf.mjs";
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

/** Le même span, tel que le SDK officiel le remet à son exportateur (ReadableSpan). */
function spanOfficiel(s: EmitSpan, ressource: ReturnType<typeof resourceFromAttributes>) {
  return {
    name: s.name,
    // L'API numérote INTERNAL à 0 ; l'OTLP, à 1 (0 y est « non précisé »).
    kind: (s.kind ?? 1) - 1,
    spanContext: () => ({ traceId: s.traceId, spanId: s.spanId, traceFlags: 1 }),
    parentSpanContext: s.parentSpanId ? { traceId: s.traceId, spanId: s.parentSpanId, traceFlags: 1, isRemote: false } : undefined,
    startTime: s.startTime,
    endTime: s.endTime,
    duration: [0, 0],
    ended: true,
    status: { code: s.status?.code ?? 0 },
    attributes: s.attributes,
    links: [],
    events: (s.events ?? []).map((e) => ({ name: e.name, time: e.time, attributes: e.attributes })),
    resource: ressource,
    instrumentationScope: SCOPE,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function officiel(format: "json"): unknown;
function officiel(format: "protobuf"): Uint8Array;
function officiel(format: "json" | "protobuf") {
  const ressource = resourceFromAttributes(RESSOURCE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spans = SPANS.map((s) => spanOfficiel(s, ressource)) as any;
  if (format === "protobuf") return ProtobufTraceSerializer.serializeRequest(spans)!;
  return JSON.parse(new TextDecoder().decode(JsonTraceSerializer.serializeRequest(spans)!));
}

describe("conformité OTLP — le SDK web écrit ce qu'écrit OpenTelemetry", () => {
  const sdk = canonique(buildResourceSpans(RESSOURCE, SPANS));
  const ref = canonique(officiel("json"));

  it("même message que le sérialiseur JSON officiel, champ par champ", () => {
    expect(sdk).toEqual(ref);
  });

  it("aucun champ que la spec OTLP ne connaît pas", () => {
    // Chaque clé émise par le SDK existe dans la sortie officielle du même lot.
    const cles = (o: unknown, acc = new Set<string>()): Set<string> => {
      if (Array.isArray(o)) o.forEach((x) => cles(x, acc));
      else if (o && typeof o === "object") for (const [k, x] of Object.entries(o)) { acc.add(k); cles(x, acc); }
      return acc;
    };
    const officielles = cles(officiel("json"));
    const inconnues = [...cles(buildResourceSpans(RESSOURCE, SPANS))].filter((k) => !officielles.has(k));
    expect(inconnues).toEqual([]);
  });

  it("le format retenu par l'officiel pour les identifiants et les dates", () => {
    type Lot = { resourceSpans: { scopeSpans: { spans: Record<string, unknown>[] }[] }[] };
    const span = (officiel("json") as Lot).resourceSpans[0].scopeSpans[0].spans[2];
    const notre = (buildResourceSpans(RESSOURCE, SPANS) as Lot).resourceSpans[0].scopeSpans[0].spans[2];
    // Identifiants en hexadécimal (et non en base64), dates en nanosecondes écrites en chaîne.
    expect(notre.traceId).toBe(span.traceId);
    expect(notre.startTimeUnixNano).toBe(span.startTimeUnixNano);
    expect(notre.endTimeUnixNano).toBe(`${T0 + 2}987654321`);
  });

  it("l'ingestion de MIP lit la sortie du SDK comme celle de l'officiel en protobuf", () => {
    // Même lot : JSON du SDK d'un côté, protobuf binaire de l'officiel de l'autre.
    expect(flattenOtlp(buildResourceSpans(RESSOURCE, SPANS))).toEqual(flattenOtlp(decoderTracesProtobuf(officiel("protobuf"))));
  });
});
