// Encodage OTLP/HTTP JSON du SDK web, sans le SDK @opentelemetry (~52 Ko minifiés).
// L'encodeur vit dans `@mip/rum-core`, partagé par les capteurs : l'ingestion
// (`flattenOtlp`) ne connaît qu'un format de fil. Ici, seul le scope du web.
import { buildResourceSpans as buildResourceSpansCore, type Attributes, type EmitSpan } from "@mip/rum-core";

export {
  SPAN_KIND,
  STATUS_CODE,
  encodeAttributes,
  hrToNanos,
  kindPour,
  msToHr,
  msToNanos,
  statutPour,
  toAnyValue,
} from "@mip/rum-core";
export type {
  Attributes,
  EmitScope,
  EmitSpan,
  HrTime,
  SpanKind,
  SpanStatus,
  StatusCode,
} from "@mip/rum-core";

/** Scope OTLP du SDK web : c'est lui que l'ingestion lit pour reconnaître l'émetteur. */
const SCOPE = { name: "@mip/rum-sdk", version: "0.4.0" };

/** Enveloppe OTLP/HTTP JSON complète pour un lot de spans web. */
export function buildResourceSpans(resourceAttrs: Attributes, spans: EmitSpan[]): unknown {
  return buildResourceSpansCore(resourceAttrs, spans, SCOPE);
}
