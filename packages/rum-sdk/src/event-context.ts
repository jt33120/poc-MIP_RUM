/**
 * Contexte d'événement du SDK web.
 *
 * La MÉCANIQUE (cinq couches, limites, précédence, snapshot figé) a été extraite
 * dans `@mip/rum-core` : elle est mot pour mot celle que doit appliquer React
 * Native, et deux copies auraient fini par appliquer deux limites différentes au
 * même contexte. Ce module ne garde que ce qui appartient au web : l'INSTANCE.
 *
 * Le singleton reste ici et n'est pas exporté par le cœur : un store partagé
 * entre runtimes ferait fuir le contexte d'une application dans l'autre le jour
 * où les deux cohabitent dans une WebView.
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
