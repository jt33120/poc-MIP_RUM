// Cœur PUR du SDK mobile (React Native) — aucun global RN, aucun import natif.
//
// Réutilise la STRATÉGIE du SDK web : émettre exactement les mêmes noms de spans
// OTLP (`exception`, `pageview`, `http.client`, `track.*`, `rum.view`,
// `rum.action`, `rum.timing`, `rum.feature_flag`) avec les attributs `mip.*`
// attendus par l'ingestion. Résultat : le mobile alimente les MÊMES tables
// (rum_error / rum_pageview / rum_span / rum_event / rum_action) sans aucun
// changement côté serveur.
//
// P7.1 : l'encodage OTLP lui-même n'est plus recopié ici — il vient de
// `@mip/rum-core`, partagé avec le SDK web et l'agent Node. Ce fichier ne garde
// que la FORME des signaux mobiles. Isolé du runtime (index.ts) -> testé par
// round-trip contre flattenOtlp.
import {
  buildResourceSpans,
  encodeAttributes,
  msToHr,
  msToNanos,
  kindPour,
  sanitizeContext,
  statutPour,
  type Attributes,
  type EmitScope,
  type EmitSpan,
} from "@mip/rum-core";

/** Version du SDK mobile : scope OTLP, `service.version` et user-agent synthétique. */
export const MOBILE_SDK_VERSION = "0.2.0";
const SCOPE: EmitScope = { name: "@mip/rum-mobile", version: MOBILE_SDK_VERSION };

// Réexports de compatibilité : `core.ts` était la seule table d'encodage du
// package avant l'extraction. Les conserver évite de casser un appelant qui les
// importait, sans laisser subsister une seconde implémentation.
export { encodeAttributes as encodeAttrs, msToNanos as nanos };

export interface MobileConfig {
  endpoint: string;
  appId: string;
  apiKey: string | null;
  env: string;
  clientId: string | null;
  /** version applicative (mip.release) — dé-minification / suivi de version. */
  appVersion: string | null;
  /** user-agent synthétique mobile (mip.user_agent), ex. "MIP-RN/0.2 (ios 17)". */
  userAgent: string;
}

/**
 * Contexte commun injecté sur chaque span (comme `prepareBase` côté web).
 *
 * Les champs P2 (contexte, identités, vue, action) sont OPTIONNELS : une
 * intégration qui n'appelle que `screen`/`track` construit exactement le même
 * `Ctx` qu'avant P7.1, et l'événement produit reste identique.
 */
export interface Ctx {
  sessionId: string;
  /**
   * Identifiant d'installation (P2 `mip.visitor_id`). `null` tant qu'aucun
   * stockage durable n'est branché : P7.2 pose l'adaptateur et la persistance.
   * Jamais un identifiant publicitaire, d'appareil ni une empreinte matérielle.
   */
  visitorId?: string | null;
  route: string | null;
  /**
   * @deprecated Ancienne empreinte de CLASSE D'APPAREIL du POC mobile. Le champ
   * reste dans le type pour ne pas casser un appelant, mais il n'est PLUS émis :
   * `mip.user_hash` n'est pas une identité personnelle, et l'ingestion marque
   * une session qui n'a que lui comme non exportable au sens RGPD. L'identité
   * métier passe par `userId`/`accountId` (HMAC app-scopé côté serveur).
   */
  userHash?: string | null;
  tz: string | null;
  /**
   * Indice d'appareil : plateforme (`ios`, `android`) ou classe (`mobile`,
   * `tablet`). P6.1 en dérive côté serveur le système ET la classe — « ios »
   * donne os=iOS + device_type=mobile, jamais device_type=ios.
   */
  deviceType: string;
  /** Contexte P2 déjà sérialisé et borné (JSON), ou null. */
  context?: string | null;
  /**
   * Identifiants métier BRUTS, transportés vers l'endpoint MIP pour y être
   * hachés en HMAC app-scopé. Aucun secret de hachage n'est embarqué dans le
   * SDK, et ces valeurs ne sont jamais écrites dans un stockage durable.
   */
  userId?: string | null;
  accountId?: string | null;
  viewId?: string | null;
  viewName?: string | null;
  /** Action causale courante (P7.3) ; non renseignée par P7.1. */
  actionId?: string | null;
}

/** Attributs `mip.*` communs à tout span mobile — miroir de `prepareBase` (web). */
export function commonAttrs(ctx: Ctx): Attributes {
  return {
    "mip.session_id": ctx.sessionId,
    "mip.visitor_id": ctx.visitorId ?? null,
    "mip.route": ctx.route,
    "mip.tz": ctx.tz,
    "mip.device_type": ctx.deviceType,
    "mip.collection_source": "sdk",
    "mip.context": ctx.context ?? null,
    "mip.identity.user_id": ctx.userId ?? null,
    "mip.identity.account_id": ctx.accountId ?? null,
    "mip.view_id": ctx.viewId ?? null,
    "mip.view_name": ctx.viewName ?? null,
    "mip.action_id": ctx.actionId ?? null,
  };
}

/**
 * Span mobile prêt à filtrer puis à encoder. Les attributs restent en clair
 * jusqu'à `buildPayload` : c'est ce qui permet à `beforeSend` de s'appliquer sur
 * un objet lisible, et non sur un tableau OTLP déjà sérialisé.
 */
function span(
  name: string,
  ctx: Ctx,
  extra: Attributes,
  tsMs: number,
  spanId: string,
  traceId?: string,
  endMs?: number,
): EmitSpan {
  const attributes = { ...commonAttrs(ctx), ...extra };
  const status = statutPour(name, attributes);
  return {
    traceId: traceId ?? spanId.padStart(32, "0"),
    spanId,
    name,
    kind: kindPour(name),
    ...(status ? { status } : {}),
    startTime: msToHr(tsMs),
    endTime: msToHr(endMs ?? tsMs),
    attributes,
  };
}

/** Crash / erreur JS non interceptée -> span `exception` (table rum_error). */
export function buildExceptionSpan(
  ctx: Ctx,
  e: { message: string; type?: string | null; stack?: string | null; fingerprint?: string | null },
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("exception", ctx, {
    "exception.message": e.message,
    "exception.type": e.type ?? null,
    "exception.stacktrace": e.stack ?? null,
    // `crash` est un noyau d'erreur NON interceptée : l'ingestion en déduit
    // handled=false. Elle n'en déduit JAMAIS is_fatal — un crash JS React Native
    // n'est pas forcément fatal, et l'inverse est vrai aussi.
    "mip.error_kind": "crash",
    "mip.error_fingerprint": e.fingerprint ?? null,
  }, tsMs, spanId);
}

/**
 * Erreur signalée par l'application (`addError`) -> span `exception` marqué
 * `error`. L'ingestion en déduit handled=true : quelqu'un l'a bien interceptée.
 */
export function buildAddErrorSpan(
  ctx: Ctx,
  e: { message: string; type: string; stack?: string | null; context?: string | null; fingerprint?: string | null },
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("exception", ctx, {
    "mip.event_type": "error",
    "mip.event_name": e.type,
    "exception.type": e.type,
    "exception.message": e.message,
    "exception.stacktrace": e.stack ?? null,
    ...(e.context ? { "mip.context": e.context } : {}),
    "mip.error_fingerprint": e.fingerprint ?? null,
  }, tsMs, spanId);
}

/** Changement d'écran -> span `pageview` (table rum_pageview). route = écran. */
export function buildScreenSpan(ctx: Ctx, tsMs: number, spanId: string): EmitSpan {
  return span("pageview", ctx, {
    "mip.url": ctx.route,
    "mip.nav_type": "screen",
  }, tsMs, spanId);
}

/** Vue nommée P2 (`startView`) -> span `rum.view` (table rum_event, type view). */
export function buildViewSpan(
  ctx: Ctx,
  view: { id: string; name: string; context?: string | null },
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("rum.view", ctx, {
    "mip.event_type": "view",
    "mip.event_name": view.name,
    "mip.view_id": view.id,
    "mip.view_name": view.name,
    ...(view.context ? { "mip.context": view.context } : {}),
  }, tsMs, spanId);
}

/** Action manuelle P2 (`addAction`) -> span `rum.action` (tables rum_event + rum_action). */
export function buildActionSpan(
  ctx: Ctx,
  action: { id: string; name: string; context?: string | null },
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("rum.action", ctx, {
    "mip.event_type": "action",
    "mip.event_name": action.name,
    "mip.action_id": action.id,
    // Aucun geste natif n'est observé en P7.1 : une action mobile est déclarée
    // par l'application. `click` mentirait sur la provenance du signal.
    "mip.action_type": "manual",
    ...(action.context ? { "mip.context": action.context } : {}),
  }, tsMs, spanId);
}

/** Timing P2 (`addTiming`) -> span `rum.timing`. La durée est relative à la vue. */
export function buildTimingSpan(
  ctx: Ctx,
  name: string,
  durationMs: number,
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("rum.timing", ctx, {
    "mip.event_type": "timing",
    "mip.event_name": name,
    "mip.timing_ms": durationMs,
  }, tsMs, spanId);
}

/** Évaluation de flag P2 -> span `rum.feature_flag`. `null` reste la chaîne "null". */
export function buildFeatureFlagSpan(
  ctx: Ctx,
  name: string,
  value: string | number | boolean | null,
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("rum.feature_flag", ctx, {
    "mip.event_type": "feature_flag",
    "mip.event_name": name,
    "mip.feature_flag_value": value == null ? "null" : String(value),
  }, tsMs, spanId);
}

/** Appel réseau -> span `http.client` (table rum_span, tier front). */
export function buildHttpSpan(
  ctx: Ctx,
  h: { traceId: string; url: string; method: string; status: number; durationMs: number },
  tsMs: number,
  spanId: string,
): EmitSpan {
  return span("http.client", ctx, {
    "mip.trace_id": h.traceId,
    "mip.span_id": spanId,
    "http.url": h.url,
    "http.method": h.method,
    "http.status_code": h.status,
    "http.duration_ms": h.durationMs,
  }, tsMs, spanId, h.traceId, tsMs + h.durationMs);
}

/**
 * Props d'un événement métier, sérialisées SANS jamais lever dans l'app hôte.
 *
 * Un objet cyclique fait échouer `JSON.stringify` : sur le web l'exception
 * remonte dans l'appelant, ce qui est déjà discutable ; dans un rendu React
 * Native, elle allumerait une redbox pour une faute de notre SDK. Le repli
 * applique le bornage du cœur partagé, qui casse le cycle par sa limite de
 * profondeur et produit toujours un objet sérialisable.
 */
function propsJson(props: Record<string, unknown>): string {
  try {
    return JSON.stringify(props) ?? "{}";
  } catch {
    return JSON.stringify(sanitizeContext(props));
  }
}

/** Événement métier -> span `track.<name>` (table rum_event). */
export function buildTrackSpan(
  ctx: Ctx,
  name: string,
  props: Record<string, unknown>,
  tsMs: number,
  spanId: string,
  context?: string | null,
): EmitSpan {
  return span(`track.${name}`, ctx, {
    "mip.props": propsJson(props),
    "mip.event_type": "custom",
    "mip.event_name": name,
    ...(context ? { "mip.context": context } : {}),
  }, tsMs, spanId);
}

/** Attributs de resource d'un lot mobile — constants pour toute la requête. */
export function resourceAttrs(cfg: MobileConfig): Attributes {
  return {
    // `mip-rum-mobile` est ce que l'ingestion lit pour reconnaître le runtime
    // React Native (error_source = react_native_js). Ne jamais le renommer sans
    // changer `runtimeClientMip` côté serveur.
    "service.name": "mip-rum-mobile",
    "service.version": MOBILE_SDK_VERSION,
    "mip.app_id": cfg.appId,
    "mip.client_id": cfg.clientId ?? "",
    "mip.user_agent": cfg.userAgent,
    "deployment.environment.name": cfg.env,
    "mip.release": cfg.appVersion,
    "mip.api_key": cfg.apiKey,
  };
}

/** Enveloppe OTLP/HTTP JSON pour un lot de spans mobiles. */
export function buildPayload(cfg: MobileConfig, spans: EmitSpan[]): unknown {
  return buildResourceSpans(resourceAttrs(cfg), spans, SCOPE);
}
