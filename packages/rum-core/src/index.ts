// @mip/rum-core — primitives PURES communes aux runtimes MIP RUM.
//
// PÉRIMÈTRE, ET CE QUI N'Y ENTRE PAS. Ce package ne contient que ce qui est
// réellement utilisé par au moins DEUX runtimes et dont le résultat ne dépend
// d'aucun environnement : validation et limites du contexte, métadonnées et
// snapshots d'événement, couture de `beforeSend`, encodeur OTLP et types.
//
// Il n'importe ni DOM, ni React Native, ni module natif Node, ni réseau. Les
// gates de consentement, les horloges, le stockage et les patchs d'API restent
// des ADAPTATEURS chez l'appelant : ce sont eux qui diffèrent d'un runtime à
// l'autre, et les mutualiser reviendrait à faire porter à un navigateur le
// comportement d'un téléphone.
export {
  CONTEXT_LIMITS,
  EventContextStore,
  boundedName,
  newEnvelopeId,
  sanitizeContext,
  validateIdentity,
} from "./context";
export type {
  ContextEnvelope,
  ContextValue,
  EventContext,
  EventMeta,
  IdentityInput,
  IdentityState,
} from "./context";

export { STRUCTURAL_ATTRIBUTES, applyBeforeSend } from "./before-send";
export type { BeforeSendFault, BeforeSendGuard, BeforeSendHook } from "./before-send";

export {
  SPAN_KIND,
  STATUS_CODE,
  buildResourceSpans,
  encodeAttributes,
  hrToNanos,
  kindPour,
  msToHr,
  msToNanos,
  statutPour,
  toAnyValue,
} from "./otlp";
export type {
  Attributes,
  EmitScope,
  EmitSpan,
  HrTime,
  SpanKind,
  SpanStatus,
  StatusCode,
} from "./otlp";
