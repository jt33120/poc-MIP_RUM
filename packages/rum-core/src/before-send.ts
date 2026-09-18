// Couture du hook public `beforeSend` — partagée par le web et React Native.
//
// Le hook est un filtre PII de dernière chance confié à l'application. Il ne
// doit jamais pouvoir casser la corrélation : les attributs STRUCTURELS (session,
// vue, action, trace, échantillonnage…) sont relus depuis l'original APRÈS le
// hook. Une application qui renomme `mip.session_id` ne casse donc pas le
// rattachement de ses propres événements — elle ne fait rien du tout.

import { boundedName, type EventMeta } from "./context";

export type BeforeSendHook = (
  attributes: Record<string, unknown>,
  meta?: EventMeta,
) => Record<string, unknown> | null;

/**
 * Attributs que `beforeSend` ne peut ni supprimer ni réécrire. Ce ne sont pas
 * des données de l'application : ce sont les clefs de jointure de sa propre
 * télémétrie, et la trace de sa politique d'échantillonnage.
 */
export const STRUCTURAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "mip.session_id", "mip.trace_id", "mip.span_id", "mip.app_id", "mip.client_id",
  "mip.visitor_id", "mip.route", "mip.tz", "mip.device_type", "mip.collection_source",
  "mip.sample_rate", "mip.error_sample_rate", "mip.event_type",
  "mip.view_id", "mip.view_name", "mip.action_id", "mip.timing_ms",
  "mip.feature_flag_value", "mip.action_type",
  // P5.2 : lien d'une erreur réseau vers le span de son appel, et voie de
  // capture dont l'ingestion dérive la source et le caractère géré.
  "mip.parent_span_id", "mip.error_kind", "mip.error_handled",
]);

/** Motif d'un refus NON CONTRACTUEL du hook — à compter, jamais à propager. */
export type BeforeSendFault = "exception" | "async";

/**
 * Isolation du hook, demandée par le runtime qui ne peut pas se permettre de
 * laisser remonter une exception applicative (React Native : le handler est
 * appelé depuis le thread JS de l'app hôte, et une exception y déclenche une
 * redbox pour une faute de notre SDK).
 *
 * Fournir ce garde CHANGE le contrat : l'événement est jeté et le motif compté,
 * au lieu de remonter. Le web ne le fournit pas — son comportement historique,
 * où une exception du hook remonte à l'appelant, reste intact.
 */
export interface BeforeSendGuard {
  /** Appelé une fois par refus non contractuel. L'appelant borne le diagnostic. */
  onFault: (fault: BeforeSendFault) => void;
}

function estThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

/** Couture pure du hook public : compatibilité un argument + champs SDK immuables. */
export function applyBeforeSend(
  hook: BeforeSendHook | undefined,
  attributes: Record<string, unknown>,
  meta: EventMeta,
  guard?: BeforeSendGuard,
): Record<string, unknown> | null {
  if (!hook) return attributes;
  const reserved = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => STRUCTURAL_ATTRIBUTES.has(key)),
  );
  let filtered: Record<string, unknown> | null;
  if (guard) {
    try {
      filtered = hook({ ...attributes }, meta);
    } catch {
      // Le contenu de l'exception applicative n'est pas journalisé : il peut
      // porter la donnée personnelle que le hook était justement chargé de
      // retirer. Seul le motif est compté.
      guard.onFault("exception");
      return null;
    }
    // `beforeSend` est SYNCHRONE. Une Promise est une entrée invalide, pas une
    // attente : attendre bloquerait le thread UI, et sérialiser l'objet Promise
    // enverrait un événement vidé de tout ce que le hook devait filtrer.
    if (estThenable(filtered)) {
      guard.onFault("async");
      return null;
    }
  } else {
    filtered = hook({ ...attributes }, meta);
  }
  if (!filtered) return null;
  const merged = Object.fromEntries(
    Object.entries(filtered).filter(([key]) => !STRUCTURAL_ATTRIBUTES.has(key)),
  );
  Object.assign(merged, reserved);
  if (meta.type === "action") {
    // L'ingestion exige un nom d'action valide. Accepter une racine dont le
    // hook a supprimé/invalidé le nom laisserait ensuite des enfants action_id
    // sans projection rum_action.
    const actionName = boundedName(merged["mip.event_name"]);
    if (!actionName) return null;
    merged["mip.event_name"] = actionName;
  }
  return merged;
}
