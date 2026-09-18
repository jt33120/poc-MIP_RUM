// Encodage OTLP/HTTP JSON du SDK web — remplace le SDK @opentelemetry (~52 Ko
// minifiés du bundle cœur).
//
// La table de correspondance elle-même vit désormais dans `@mip/rum-core` : le
// format de fil est le MÊME pour le web, React Native et l'agent Node, et
// l'ingestion (`flattenOtlp`) n'en connaît qu'un. Trois copies d'un encodeur
// AnyValue, c'est trois occasions d'envoyer un `intValue` en nombre d'un côté et
// en chaîne de l'autre.
//
// Ce module ne garde que ce qui est propre au web : son SCOPE d'émetteur.
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
