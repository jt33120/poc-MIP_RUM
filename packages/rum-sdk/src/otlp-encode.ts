// Encodage OTLP/HTTP JSON — remplace le SDK @opentelemetry (~52 Ko minifiés du
// bundle cœur). Le format de fil produit ici est EXACTEMENT celui qu'attend
// l'ingestion (`flattenOtlp`) : `resourceSpans[].resource.attributes` +
// `scopeSpans[].spans[]`, valeurs en AnyValue typé (stringValue / intValue en
// chaîne / doubleValue / boolValue) et `timeUnixNano` en chaîne (la précision
// nanoseconde dépasse 2^53, donc pas de number). Logique 100 % pure, sans
// dépendance ni API navigateur -> verrouillée par un test round-trip contre
// flattenOtlp (tests/unit/otlp-emitter.test.ts).

/** [secondes epoch, nanosecondes] — même découpage que l'HrTime OpenTelemetry. */
export type HrTime = [number, number];

export type Attributes = Record<string, unknown>;

/** Span prêt à sérialiser : représentation interne de l'émetteur. */
export interface EmitSpan {
  name: string;
  traceId: string; // hex 16 octets (32 caractères)
  spanId: string; // hex 8 octets (16 caractères)
  startTime: HrTime;
  endTime: HrTime;
  attributes: Attributes;
}

/**
 * AnyValue OTLP. Encodage aligné sur `anyValue()` côté ingestion :
 * chaîne -> stringValue ; booléen -> boolValue ; entier -> intValue (en chaîne,
 * convention int64) ; réel -> doubleValue.
 */
export function toAnyValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}

/**
 * Tableau OTLP `[{key, value}]`. Ignore null/undefined (attribut absent) et les
 * valeurs non scalaires (le contrat MIP passe les objets déjà sérialisés en JSON
 * string en amont, ex. mip.props / webvital.attribution).
 */
export function encodeAttributes(
  attrs: Attributes,
): Array<{ key: string; value: Record<string, unknown> }> {
  const out: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (const [key, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
      out.push({ key, value: toAnyValue(v) });
    }
  }
  return out;
}

/** HrTime -> nanosecondes epoch en chaîne (fixed64) ; précision préservée. */
export function hrToNanos(hr: HrTime): string {
  return `${hr[0]}${String(hr[1]).padStart(9, "0")}`;
}

/** Epoch millisecondes (entier) -> HrTime. Les timestamps MIP sont en ms entières. */
export function msToHr(ms: number): HrTime {
  const m = Math.round(ms);
  return [Math.floor(m / 1000), (m % 1000) * 1_000_000];
}

const SCOPE = { name: "@mip/rum-sdk", version: "0.4.0" };

/** Enveloppe OTLP/HTTP JSON complète pour un lot de spans. */
export function buildResourceSpans(resourceAttrs: Attributes, spans: EmitSpan[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: encodeAttributes(resourceAttrs) },
        scopeSpans: [
          {
            scope: SCOPE,
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              name: s.name,
              startTimeUnixNano: hrToNanos(s.startTime),
              endTimeUnixNano: hrToNanos(s.endTime),
              attributes: encodeAttributes(s.attributes),
            })),
          },
        ],
      },
    ],
  };
}
