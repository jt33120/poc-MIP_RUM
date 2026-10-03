/**
 * Contexte d'événement du SDK web : la mécanique vit dans `@mip/rum-core`, partagée
 * avec React Native. Le singleton reste ici : partagé entre runtimes, il ferait
 * fuir le contexte d'une application dans l'autre au sein d'une WebView.
 */
import { EventContextStore } from "@mip/rum-core";

export {
  CONTEXT_LIMITS,
  EventContextStore,
  boundedName,
  newEnvelopeId,
  sanitizeContext,
} from "@mip/rum-core";
export type {
  ContextEnvelope,
  ContextValue,
  EventContext,
  EventMeta,
  IdentityInput,
} from "@mip/rum-core";

export const eventContext = new EventContextStore();
