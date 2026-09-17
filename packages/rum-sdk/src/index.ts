import { initApiSpans } from "./apispans";
import { ActionTracker, actionAttrs, initAutomaticActions } from "./actions";
import { createBreadcrumbTrail, initClickBreadcrumbs, MIP_UI_ATTR, type BreadcrumbTrail } from "./breadcrumbs";
import { ConsentGate } from "./consent";
import { currentRoute, initNavigation, scrubUrl } from "./context";
import { initConsoleErrors, initCspErrors, initResourceErrors } from "./error-capture";
import { initErrors, type Emit } from "./errors";
import { initForms } from "./forms";
import { initFrustration, type FrustrationWatch } from "./frustration";
import { initLoaf } from "./loaf";
import { initLongTasks } from "./longtasks";
import { currentTraceId, discardPendingSpans, forceFlush, initOtel, newPageTrace } from "./otel";
import { flushReplayBoundary, isReplaySampled, startReplay } from "./replay";
import { DEFAULT_SLOW_RESOURCE_MS, initResources } from "./resources";
import { purgeRetryQueue, replayRetryQueue } from "./retry";
import { createSampler, decideMode, loadMode, storeMode } from "./sampling";
import { readPrivacySignals, signalsOptOut } from "./privacy";
import { getOrCreateSession, rotateSession, touchSession, type Session } from "./session";
import type {
  AddErrorOptions,
  ErrorCategory,
  ErrorCollectionStats,
  MIPRumConfig,
} from "./types";
import { initNavTiming } from "./navtiming";
import { initVitals } from "./vitals";
import {
  boundedName,
  eventContext,
  newEnvelopeId,
  sanitizeContext,
  type EventContext,
  type EventMeta,
  type IdentityInput,
} from "./event-context";

export type { EventContext, EventMeta, IdentityInput } from "./event-context";

let session: Session | null = null;
let initialized = false;
// appId de la session courante, lu par le widget d'avis (MIPRum.appId()) pour
// cloisonner sa période de silence PAR APPLICATION. Renseigné avant toute
// sortie anticipée d'init() : deux apps du même navigateur ne doivent pas se
// masquer l'une l'autre, y compris quand la collecte est refusée.
let appIdValue = "";
let emitter: ((name: string, attrs: Parameters<Emit>[1], ts?: number) => boolean) | null = null;
let trail: BreadcrumbTrail | null = null;
let gate: ConsentGate | null = null;
let deliver: Emit | null = null; // émission réelle (post-consent)
let replayRetry: (() => void) | null = null;
let replayArm: (() => void) | null = null; // replay échantillonné, en attente de consent
let drainErrors: (() => void) | null = null;
let resetErrors: (() => void) | null = null;
let markManualError: ((error: Error) => void) | null = null;
let errorStats: (() => ErrorCollectionStats) | null = null;
let causalActions: ActionTracker | null = null;
let collectionOrigin: (at?: number) => Record<string, string | number | boolean> = () => ({});
let updateCollectionConsent: ((granted: boolean) => void) | null = null;

const COLLECTION_EPOCH = "mip.collection_epoch";
const COLLECTION_ALLOWED = "mip.collection_allowed";

const CAUSAL_ATTR_KEYS = [
  "mip.action_id", "mip.action_epoch", "mip.session_id", "mip.route",
  "mip.context", "mip.view_id", "mip.view_name",
  "mip.identity.user_id", "mip.identity.account_id",
] as const;

/** Isole l'enveloppe causale : aucun message/stack d'erreur n'est recopié aux signaux frères. */
function causalOnly(attributes: Record<string, unknown>): Record<string, string | number | boolean> {
  const captured: Record<string, string | number | boolean> = {};
  for (const key of CAUSAL_ATTR_KEYS) {
    const value = attributes[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") captured[key] = value;
  }
  return captured;
}

/** Fusion P2 : contexte d'action puis contexte local d'erreur, le plus local gagne. */
function mergeSerializedContexts(actionRaw: unknown, localRaw: unknown): string | undefined {
  const parse = (value: unknown): EventContext => {
    if (typeof value !== "string") return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const merged = sanitizeContext({ ...parse(actionRaw), ...parse(localRaw) });
  return Object.keys(merged).length ? JSON.stringify(merged) : undefined;
}

/** Couture pure du hook public : compatibilité un argument + champs SDK immuables. */
export function applyBeforeSend(
  hook: MIPRumConfig["beforeSend"],
  attributes: Record<string, unknown>,
  meta: EventMeta,
): Record<string, unknown> | null {
  if (!hook) return attributes;
  const structural = new Set([
    "mip.session_id", "mip.trace_id", "mip.span_id", "mip.app_id", "mip.client_id",
    "mip.visitor_id", "mip.route", "mip.tz", "mip.device_type", "mip.collection_source",
    "mip.sample_rate", "mip.error_sample_rate", "mip.event_type",
    "mip.view_id", "mip.view_name", "mip.action_id", "mip.timing_ms",
    "mip.feature_flag_value", "mip.action_type",
    // P5.2 : lien d'une erreur réseau vers le span de son appel, et voie de
    // capture dont l'ingestion dérive la source et le caractère géré.
    "mip.parent_span_id", "mip.error_kind", "mip.error_handled",
  ]);
  const reserved = Object.fromEntries(Object.entries(attributes).filter(([key]) => structural.has(key)));
  const filtered = hook({ ...attributes }, meta);
  if (!filtered) return null;
  const merged = Object.fromEntries(
    Object.entries(filtered).filter(([key]) => !structural.has(key)),
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

/**
 * Une seule couture pour tous les chemins qui vident les répétitions d'erreur.
 * Exposée pour couvrir le vrai câblage navigateur sans démarrer tout le SDK :
 * pagehide/visibilitychange, navigation SPA et MIPRum.flush() doivent drainer
 * exactement une fois, avant l'export correspondant.
 */
export function wireErrorDrainLifecycle(
  drain: () => void,
  flush: () => Promise<void> | void,
): { onSpaNavigation: () => void; onPublicFlush: () => void } {
  const beforeExport = () => {
    drain();
    void flush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") beforeExport();
  });
  addEventListener("pagehide", beforeExport, { capture: true });
  return { onSpaNavigation: beforeExport, onPublicFlush: drain };
}

// src du script SDK, capturé au CHARGEMENT du module (document.currentScript est
// nul une fois le script exécuté) — sert à résoudre mip-rum-feedback.js à la même
// origine/dossier que le SDK, comme le bundle replay.
const sdkScriptSrc =
  typeof document !== "undefined"
    ? ((document.currentScript as HTMLScriptElement | null)?.src ?? null)
    : null;

/** Charge en lazy le widget d'avis (mip-rum-feedback.js) depuis l'origine du SDK.
 *  Idempotent : le widget se garde lui-même via window.__mipRumFeedbackMounted. */
function loadFeedbackWidget(opt: boolean | { label?: string; accent?: string }): void {
  if (typeof document === "undefined") return;
  const w = window as unknown as { __mipRumFeedbackMounted?: boolean; MIPRumFeedback?: unknown };
  if (w.__mipRumFeedbackMounted) return;
  if (opt && typeof opt === "object") w.MIPRumFeedback = opt; // { label, accent } avant chargement
  const url = sdkScriptSrc ? new URL("mip-rum-feedback.js", sdkScriptSrc).href : "/mip-rum-feedback.js";
  const s = document.createElement("script");
  s.src = url;
  s.defer = true;
  // Son échec de chargement n'est pas une erreur de ressource de l'application.
  s.setAttribute(MIP_UI_ATTR, "");
  document.head.appendChild(s);
}

export function init(cfg: MIPRumConfig): void {
  if (initialized) return;
  if (!cfg || !cfg.endpoint || !cfg.appId) {
    console.warn("[MIPRum] init: endpoint and appId are required");
    return;
  }
  appIdValue = cfg.appId;
  // Souveraineté / RGPD (Lot 5) : on honore les signaux navigateur d'opt-out
  // (DNT/GPC). Si un refus est signalé, on ne collecte RIEN — aucune session
  // n'est créée, aucun listener posé, aucune requête émise. Désactivable via
  // honorDNT:false pour les apps qui pilotent un consentement affirmatif
  // (MIPRum.consent()) susceptible de primer le signal.
  if (
    cfg.honorDNT !== false &&
    signalsOptOut(
      readPrivacySignals(
        typeof navigator !== "undefined" ? navigator : undefined,
        typeof window !== "undefined" ? window : undefined,
      ),
    )
  ) {
    return;
  }
  // Échantillonnage intelligent (A1) : décision par session, persistée pour
  // rester stable au fil des pageviews/reloads. "off" => on ne collecte rien.
  session = getOrCreateSession();
  const mode0 = loadMode(session.sessionId) ?? decideMode(cfg);
  storeMode(session.sessionId, mode0);
  if (mode0 === "off") {
    session = null;
    return;
  }
  initialized = true;
  // promotion "error-biased" -> "full" persistée (la session reste "full" après reload)
  const sampler = createSampler(mode0, () => storeMode(session!.sessionId, "full"));

  const tracer = initOtel(cfg);
  // fuseau horaire (B1 : mapping tz -> geo_country à l'ingestion, zéro IP stockée)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // émission réelle : crée le span OTel (ts optionnel = rejeu consent/retry)
  const realEmit: Emit = (name, attrs, ts) => {
    const span =
      ts != null ? tracer.startSpan(name, { startTime: ts }) : tracer.startSpan(name);
    span.setAttributes(attrs as Record<string, string | number>);
    if (ts != null) span.end(ts);
    else span.end();
    // INP/CLS finals arrivent pendant le passage en hidden : flush immédiat
    // pour que le beacon parte avant l'unload
    if (document.visibilityState === "hidden") forceFlush().catch(() => {});
  };
  deliver = realEmit;

  // consent mode : tout passe par la gate (0 span créé => 0 requête réseau)
  gate = new ConsentGate(cfg.requireConsent ?? false);
  let collectionEpoch = 0;
  let collectionAllowed = true; // consentement en attente = buffer autorisé
  const consentHistory: Array<{ at: number; epoch: number; allowed: boolean }> = [
    { at: Number.NEGATIVE_INFINITY, epoch: collectionEpoch, allowed: collectionAllowed },
  ];
  collectionOrigin = (at = Date.now()) => {
    let state = consentHistory[0];
    for (const transition of consentHistory) {
      if (transition.at > at) break;
      state = transition;
    }
    return { [COLLECTION_EPOCH]: state.epoch, [COLLECTION_ALLOWED]: state.allowed };
  };
  updateCollectionConsent = (granted) => {
    if (!granted) collectionEpoch++;
    collectionAllowed = granted;
    consentHistory.push({ at: Date.now(), epoch: collectionEpoch, allowed: collectionAllowed });
  };
  // échantillonnage : en "error-biased", seules les erreurs passent ; la 1re
  // erreur promeut la session en "full" (le reste de la session est alors capté).
  // Renvoie true si l'événement a été PRIS EN CHARGE (livré ou bufferisé en
  // attente de consentement), false s'il a été jeté — par l'échantillonnage ou
  // par un refus de consentement. `Emit` déclare `void` : un retour booléen lui
  // reste assignable, et les appelants qui l'ignorent ne changent pas.
  const prepareBase = (
    name: string,
    attrs: Parameters<Emit>[1],
    options: { allowUnacceptedAction?: boolean; preserveEpoch?: boolean } = {},
  ): Record<string, unknown> | null => {
    // `mip.action_epoch` ne quitte jamais le SDK : c'est un témoin interne qui
    // révoque les callbacks tardifs après refus de consentement/session changée.
    const causal = name === "rum.action"
      ? { ...attrs }
      : (causalActions?.validate(attrs, true, options.allowUnacceptedAction) ?? attrs);
    const originEpoch = causal[COLLECTION_EPOCH];
    const originAllowed = causal[COLLECTION_ALLOWED];
    delete causal[COLLECTION_EPOCH];
    delete causal[COLLECTION_ALLOWED];
    if (originAllowed === false || (typeof originEpoch === "number" && originEpoch !== collectionEpoch)) {
      return null;
    }
    const current = session!;
    touchSession(current);
    const envelope = eventContext.envelope();
    const snapshotted: Record<string, unknown> = {
      "mip.session_id": current.sessionId,
      "mip.visitor_id": current.visitorId,
      "mip.route": currentRoute(),
      "mip.tz": tz,
      "mip.device_type": /mobile|tablet/i.test(navigator.userAgent) ? "mobile" : "desktop",
      "mip.collection_source": cfg.collectionSource === "extension" ? "extension" : "sdk",
      ...(envelope.context ? { "mip.context": envelope.context } : {}),
      ...(envelope.userId ? { "mip.identity.user_id": envelope.userId } : {}),
      ...(envelope.accountId ? { "mip.identity.account_id": envelope.accountId } : {}),
      ...(envelope.viewId ? { "mip.view_id": envelope.viewId } : {}),
      ...(envelope.viewName ? { "mip.view_name": envelope.viewName } : {}),
      ...causal,
    };
    const internalEpoch = snapshotted["mip.action_epoch"];
    const publicSnapshot = { ...snapshotted };
    delete publicSnapshot["mip.action_epoch"];
    const meta: EventMeta = {
      type: typeof publicSnapshot["mip.event_type"] === "string"
        ? publicSnapshot["mip.event_type"] as EventMeta["type"]
        : name === "exception" ? "error" : name.startsWith("track.") ? "custom" : "telemetry",
      name: typeof publicSnapshot["mip.event_name"] === "string" ? String(publicSnapshot["mip.event_name"]) : name,
    };
    const filtered = applyBeforeSend(cfg.beforeSend, publicSnapshot, meta);
    if (!filtered) return null;
    if (options.preserveEpoch && typeof internalEpoch === "number") {
      filtered["mip.action_epoch"] = internalEpoch;
    }
    return filtered;
  };

  const submitBase = (name: string, attrs: Record<string, unknown>, ts?: number): boolean => {
    const outbound = { ...attrs };
    delete outbound["mip.action_epoch"];
    return gate!.submit(name, outbound as Parameters<Emit>[1], realEmit, ts);
  };

  type EmitDecision = "accepted" | "sampled_out" | "rejected";
  const emitBaseDecision = (name: string, attrs: Parameters<Emit>[1], ts?: number): EmitDecision => {
    if (!sampler.passes(name)) return "sampled_out";
    const prepared = prepareBase(name, attrs);
    if (!prepared) return "rejected";
    return submitBase(name, prepared, ts) ? "accepted" : "rejected";
  };
  const emitBase = (name: string, attrs: Parameters<Emit>[1], ts?: number): boolean => {
    return emitBaseDecision(name, attrs, ts) === "accepted";
  };

  causalActions = new ActionTracker({
    emitRoot: (attrs, ts) => emitBaseDecision("rum.action", attrs, ts),
    rootSnapshot: (context) => {
      const current = session!;
      const envelope = eventContext.envelope(context);
      return {
        "mip.session_id": current.sessionId,
        "mip.route": currentRoute(),
        ...(envelope.context ? { "mip.context": envelope.context } : {}),
        ...(envelope.userId ? { "mip.identity.user_id": envelope.userId } : {}),
        ...(envelope.accountId ? { "mip.identity.account_id": envelope.accountId } : {}),
        ...(envelope.viewId ? { "mip.view_id": envelope.viewId } : {}),
        ...(envelope.viewName ? { "mip.view_name": envelope.viewName } : {}),
      };
    },
    sessionId: () => session!.sessionId,
    newId: newEnvelopeId,
  });

  let frustrationWatch: FrustrationWatch | null = null;
  const emit = (name: string, attrs: Parameters<Emit>[1], ts?: number): boolean => {
    if (name !== "exception") return emitBase(name, attrs, ts);
    if (!sampler.passes(name)) return false;

    // Construire l'exception finale SANS promouvoir ni rejouer : beforeSend a
    // le dernier mot. Un refus ne doit laisser ni racine ni frustration.error.
    let causal = causalActions!.validate(attrs, true);
    let needsRootReplay = false;
    if (typeof causal["mip.action_id"] !== "string") {
      const localContext = causal["mip.context"];
      const root = actionAttrs(causalActions!.errorCandidate(ts ?? Date.now()));
      const mergedContext = mergeSerializedContexts(root["mip.context"], localContext);
      causal = { ...causal, ...root };
      if (mergedContext) causal["mip.context"] = mergedContext;
      causal = causalActions!.validate(causal, true, true);
      needsRootReplay = typeof causal["mip.action_id"] === "string";
    }
    const prepared = prepareBase(name, causal, {
      allowUnacceptedAction: needsRootReplay,
      preserveEpoch: true,
    });
    if (!prepared) return false;

    // Seulement après acceptation du hook : promotion puis racine, avant les
    // deux effets liés. L'ordre observable reste racine → frustration → erreur.
    sampler.notifyError();
    if (needsRootReplay) {
      const root = causalActions!.forError(ts ?? Date.now());
      if (!root || root.id !== prepared["mip.action_id"]) {
        delete prepared["mip.action_id"];
        delete prepared["mip.action_epoch"];
      }
    }
    const actionId = prepared["mip.action_id"];
    if (typeof actionId === "string" && causalActions!.markError(actionId)) {
      // Le nom original du contrôle peut avoir été pseudonymisé par beforeSend.
      // La jointure action_id restitue déjà le libellé filtré côté console : ne
      // dupliquons jamais ici le texte DOM pré-hook.
      frustrationWatch?.error?.(causalOnly(prepared), "action", ts);
    }
    return submitBase(name, prepared, ts);
  };
  emitter = emit;

  trail = createBreadcrumbTrail(emit);
  const resourceCap = initResources(emit, {
    slowResourceMs: cfg.slowResourceMs ?? DEFAULT_SLOW_RESOURCE_MS,
    endpoint: cfg.endpoint,
    actionAt: (at) => ({ ...collectionOrigin(at), ...actionAttrs(causalActions!.atTimestamp(at)) }),
  });
  // Blocage du fil principal : LoAF si le navigateur le connaît, Long Tasks
  // sinon. JAMAIS LES DEUX — un même blocage produit une entrée de chaque côté,
  // et les compter tous les deux doublerait le nombre de blocages affiché. LoAF
  // est le successeur : il porte en plus le script responsable, ce qui est la
  // seule information dont on puisse faire un correctif.
  const longtaskCap = initLoaf(emit) ?? initLongTasks(emit);
  // Ordre volontaire : la racine s'ouvre avant le breadcrumb du même clic.
  initAutomaticActions(causalActions);
  initClickBreadcrumbs(trail, () => actionAttrs(causalActions!.current()));
  // signaux de frustration (P1) : rage/dead clicks ; opt-out via cfg.frustration=false
  frustrationWatch = initFrustration(emit, {
    enabled: cfg.frustration !== false,
    action: () => ({ ...collectionOrigin(), ...actionAttrs(causalActions!.origin()) }),
  });
  initVitals(emit);
  // Décomposition réseau (DNS/TCP/TLS/requête/réponse) + qualité du lien : la
  // CAUSE derrière le TTFB, qui n'en donnait que le symptôme.
  initNavTiming(emit);
  // form analytics (Lot 7) : instrumentation champ par champ ; opt-out via cfg.forms=false
  if (cfg.forms !== false) initForms(emit);

  // chaque erreur laisse aussi un breadcrumb (parcours menant à l'erreur)
  // `errorCap` : plafond par page ET déduplication par empreinte (finding 2.1).
  // Il rejoint les autres plafonds remis à zéro à chaque page vue, ci-dessous.
  const errorCap = initErrors((name, attrs, ts) => {
    if (!emit(name, attrs, ts)) return false;
    // Le breadcrumb d'erreur est un enfant causal lui aussi. On ne lui recopie
    // que l'enveloppe figée à l'occurrence (jamais message/stack), afin qu'un
    // drain après un nouveau clic ne le réattribue pas à l'action courante.
    trail?.add(
      "error",
      String(attrs["exception.message"] ?? "error"),
      causalActions!.validate(causalOnly(attrs)),
    );
    return true;
  }, Date.now, (at) => {
    // Une répétition peut être drainée après un changement de contexte ou
    // d'identité. Figer ici l'enveloppe complète de l'occurrence évite de la
    // réétiqueter avec la session/utilisateur courant au moment du drain.
    const current = session!;
    const envelope = eventContext.envelope();
    return {
      ...collectionOrigin(at),
      "mip.session_id": current.sessionId,
      "mip.visitor_id": current.visitorId,
      "mip.route": currentRoute(),
      ...(envelope.context ? { "mip.context": envelope.context } : {}),
      ...(envelope.userId ? { "mip.identity.user_id": envelope.userId } : {}),
      ...(envelope.accountId ? { "mip.identity.account_id": envelope.accountId } : {}),
      ...(envelope.viewId ? { "mip.view_id": envelope.viewId } : {}),
      ...(envelope.viewName ? { "mip.view_name": envelope.viewName } : {}),
      ...actionAttrs(causalActions!.origin(at)),
    };
  });
  const errorLifecycle = wireErrorDrainLifecycle(
    () => errorCap.drainer(Date.now()),
    forceFlush,
  );
  drainErrors = errorLifecycle.onPublicFlush;
  resetErrors = () => errorCap.reset();
  markManualError = (error) => {
    errorCap.dejaCapture(error, "manual");
  };

  // Origines de l'ingestion MIP : jamais instrumentées par le tracing (pas de
  // boucle SDK -> SDK), jamais signalées par la voie CSP.
  const denyOrigins: string[] = [];
  for (const u of [
    cfg.endpoint,
    cfg.replayEndpoint ?? cfg.endpoint.replace("/v1/traces", "/v1/replay"),
  ]) {
    try {
      denyOrigins.push(new URL(u, location.href).origin);
    } catch {
      /* endpoint relatif invalide : ignoré */
    }
  }

  // Collecte élargie (P5.2) : chaque voie est opt-in et rejoint errorCap. La voie
  // réseau vit dans les wrappers du tracing : sans eux, elle n'existe pas.
  const capture = cfg.captureErrors ?? {};
  const network = cfg.trace !== false ? capture.network : undefined;
  const enabled: Record<ErrorCategory, boolean> = {
    uncaught: true,
    console: Boolean(capture.console),
    resources: Boolean(capture.resources),
    csp: Boolean(capture.csp),
    network: Boolean(network),
  };
  const unsupported: Record<ErrorCategory, string[]> = {
    uncaught: [],
    console: enabled.console ? initConsoleErrors(errorCap) : [],
    resources: [],
    csp: enabled.csp ? initCspErrors(errorCap, denyOrigins) : [],
    network: enabled.network
      ? [
          ...(typeof window.fetch === "function" ? [] : ["fetch"]),
          ...(typeof XMLHttpRequest === "function" ? [] : ["XMLHttpRequest"]),
        ]
      : [],
  };
  if (enabled.resources) initResourceErrors(errorCap);
  errorStats = () => {
    const compteurs = errorCap.compteurs();
    const stats = {} as ErrorCollectionStats;
    for (const voie of Object.keys(compteurs) as ErrorCategory[]) {
      stats[voie] = { enabled: enabled[voie], unsupported: [...unsupported[voie]], ...compteurs[voie] };
    }
    return stats;
  };

  // tracing distribué (v0.4) : fetch/XHR -> traceparent + span 'http.client'.
  let apiCap: ReturnType<typeof initApiSpans> | null = null;
  if (cfg.trace !== false) {
    apiCap = initApiSpans(emit, {
      extraOrigins: Array.isArray(cfg.trace)
        ? cfg.trace.map((o) => o.replace(/\/+$/, ""))
        : [],
      denyOrigins,
      sessionId: () => session!.sessionId,
      traceId: currentTraceId, // même trace que la page vue (E0)
      action: () => ({ ...collectionOrigin(), ...actionAttrs(causalActions!.origin()) }),
      ...(network
        ? {
            errors: {
              clientErrors: typeof network === "object" && network.clientErrors === true,
              aborts: typeof network === "object" && network.aborts === true,
              report: (attrs, ts) => errorCap.report("network", attrs, ts),
            },
          }
        : {}),
    });
  }

  initNavigation((navType) => {
    causalActions!.close();
    // nouvelle page vue = nouvelle trace W3C (E0) : ouverte AVANT le span
    // pageview pour qu'il en soit le premier span. Borne la taille des traces.
    newPageTrace();
    const vue = eventContext.currentView();
    if (!vue || vue.route !== currentRoute()) eventContext.startView(currentRoute(), currentRoute());
    // caps par page : remis à zéro à chaque pageview (initiale et SPA)
    resourceCap.reset();
    longtaskCap.reset();
    apiCap?.reset();
    frustrationWatch?.reset();
    errorLifecycle.onSpaNavigation();
    // Le span final doit être mis dans le batch AVANT qu'une navigation SPA ne
    // remette les compteurs à zéro.
    errorCap.reset();
    trail!.cap.reset();
    emit("pageview", {
      "mip.url": scrubUrl(location.href),
      "mip.referrer": scrubUrl(document.referrer),
      "mip.nav_type": navType,
    });
    trail!.add("nav", currentRoute());
  });

  // file retry : rejoue les spans d'un load précédent dont l'export a échoué
  replayRetry = () => {
    replayRetryQueue((name, attrs, startMs, endMs) => {
      const span = tracer.startSpan(name, { startTime: startMs });
      span.setAttributes(attrs);
      span.end(endMs);
    });
  };

  // session replay (B2) : échantillonné une fois à l'init, démarré seulement
  // quand le consent est acquis (lazy-load du bundle séparé mip-rum-replay.js)
  replayArm = isReplaySampled(cfg.replay)
    ? () => startReplay(cfg, () => session!.sessionId)
    : null;

  if (gate.granted) {
    replayRetry();
    replayArm?.();
  }

  // widget d'avis (opt-in) : chargé en lazy à la même origine que le SDK. Le
  // retour part par MIPRum.track('feedback') -> passe donc par le gate de consent.
  if (cfg.feedback) loadFeedbackWidget(cfg.feedback);
}

/**
 * Consent mode RGPD : MIPRum.consent(true) débloque la collecte et rejoue le
 * buffer mémoire (+ la file retry) ; consent(false) purge et désactive.
 */
export function consent(granted: boolean): void {
  if (!gate || !deliver) return; // init() non appelé ou session non échantillonnée
  updateCollectionConsent?.(granted);
  causalActions?.consent(granted);
  if (!granted) {
    // Le buffer de consentement n'est pas la seule mémoire du SDK : les erreurs
    // compactées et la file offline attendent aussi un drain futur. Un refus
    // explicite doit les rendre irrécupérables, pas les rejouer au ré-accord.
    resetErrors?.();
    purgeRetryQueue();
    discardPendingSpans();
  } else {
    // Les occurrences vues pendant une période explicitement refusée ne
    // doivent ni retarder ni grossir la première erreur post-réaccord.
    resetErrors?.();
  }
  gate.set(granted, deliver);
  if (granted) {
    replayRetry?.();
    replayArm?.(); // replay en attente de consent : démarre maintenant
  }
}

/**
 * Événement métier : MIPRum.track("partner_search", {results: 12}).
 * Émis comme span 'track.<name>' avec mip.props (JSON) — persisté en v0.2
 * dans rum_event — et laisse un breadcrumb 'custom'.
 */
export function track(
  name: string,
  props: Record<string, unknown> = {},
  context: EventContext = {},
): boolean {
  // Le retour dit si l'événement est PARTI (ou a été bufferisé pour partir), et
  // non s'il a été « accepté par l'API ». false = jeté avant toute émission :
  // init() jamais appelé, opt-out DNT/GPC, session "off", ou mode
  // "error-biased" — où seules les erreurs passent. Un appelant qui affiche une
  // confirmation à l'utilisateur DOIT le consulter : sans lui, le widget d'avis
  // annonçait « envoyé » sur un avis silencieusement jeté.
  const safeName = boundedName(name);
  if (!safeName) return false;
  const envelope = eventContext.envelope({}, { ...props, ...context });
  const accepted = emitter?.(`track.${safeName}`, {
    "mip.props": JSON.stringify(props),
    "mip.event_type": "custom",
    "mip.event_name": safeName,
    ...(envelope.context ? { "mip.context": envelope.context } : {}),
  }) ?? false;
  trail?.add("custom", safeName);
  return accepted;
}

/** Remplace le contexte global appliqué aux événements futurs. */
export function setGlobalContext(context: EventContext): void {
  eventContext.setGlobal(context);
}

export function setGlobalContextProperty(key: string, value: unknown): void {
  eventContext.setGlobalProperty(key, value);
}

export function removeGlobalContextProperty(key: string): void {
  eventContext.removeGlobalProperty(key);
}

export function clearGlobalContext(): void { eventContext.setGlobal({}); }

export function getGlobalContext(): Readonly<EventContext> { return eventContext.getGlobal(); }

/** Définit ou efface l'identité utilisateur métier. L'identifiant brut reste en mémoire. */
export function setUser(user: string | IdentityInput | null): void {
  if (eventContext.setUser(user) && initialized && session) {
    drainErrors?.();
    resetErrors?.();
    causalActions?.close();
    flushReplayBoundary();
    session = rotateSession(session.visitorId);
  }
}

export function clearUser(): void { setUser(null); }

/** Définit ou efface l'identité compte métier. L'identifiant brut reste en mémoire. */
export function setAccount(account: string | IdentityInput | null): void {
  if (eventContext.setAccount(account) && initialized && session) {
    drainErrors?.();
    resetErrors?.();
    causalActions?.close();
    flushReplayBoundary();
    session = rotateSession(session.visitorId);
  }
}

export function clearAccount(): void { setAccount(null); }

/** Démarre une vue nommée stable, sans modifier la route normalisée. */
export function startView(name: string, context: EventContext = {}): boolean {
  const view = eventContext.startView(name, currentRoute(), context);
  if (!view) return false;
  const envelope = eventContext.envelope();
  return emitter?.("rum.view", {
    "mip.event_type": "view",
    "mip.event_name": view.name,
    "mip.view_id": view.id,
    "mip.view_name": view.name,
    ...(envelope.context ? { "mip.context": envelope.context } : {}),
  }) ?? false;
}

/** Émet une action manuelle et ouvre la même fenêtre causale que le clic automatique. */
export function addAction(name: string, context: EventContext = {}): boolean {
  const safeName = boundedName(name);
  if (!safeName || !causalActions) return false;
  return causalActions.open(safeName, "manual", context);
}

/** Émet un timing relatif au début de la vue courante. */
export function addTiming(name: string, timestamp: number = Date.now()): boolean {
  const safeName = boundedName(name);
  if (!safeName) return false;
  const duration = eventContext.timing(safeName, timestamp);
  if (duration == null) return false;
  return emitter?.("rum.timing", {
    "mip.event_type": "timing",
    "mip.event_name": safeName,
    "mip.timing_ms": duration,
  }) ?? false;
}

/** Émet une évaluation bornée puis la rattache au contexte futur de la vue. */
export function addFeatureFlagEvaluation(name: string, value: string | number | boolean | null): boolean {
  const safeName = boundedName(name);
  if (!safeName || !eventContext.addFlag(safeName, value)) return false;
  return emitter?.("rum.feature_flag", {
    "mip.event_type": "feature_flag",
    "mip.event_name": safeName,
    "mip.feature_flag_value": value == null ? "null" : String(value),
  }) ?? false;
}

/**
 * Signale explicitement une erreur en réutilisant la voie exception existante.
 *
 * `options.fingerprint` : clé de regroupement opaque, bornée comme un nom (100
 * caractères). Elle voyage en `mip.error_fingerprint` : prioritaire dans le
 * regroupement v2 des issues, sans rien changer à la signature historique ; une
 * clé invalide est ignorée, jamais l'erreur.
 */
export function addError(
  error: Error | string,
  context: EventContext = {},
  options: AddErrorOptions = {},
): boolean {
  const message = typeof error === "string" ? error : error.message;
  const errorName = boundedName(typeof error === "string" ? "Error" : error.name) ?? "Error";
  const safeMessage = message.length <= 500 ? message : message.slice(0, 500);
  const safeStack = typeof error === "string" || !error.stack ? null : error.stack.slice(0, 4000);
  const envelope = eventContext.envelope({}, context);
  const fingerprint = boundedName(options?.fingerprint);
  // Un console.error du même objet dans la même tâche n'en fait pas un second incident.
  if (typeof error !== "string") markManualError?.(error);
  return emitter?.("exception", {
    "mip.event_type": "error",
    "mip.event_name": errorName,
    "exception.type": errorName,
    "exception.message": safeMessage,
    ...(safeStack ? { "exception.stacktrace": safeStack } : {}),
    ...(envelope.context ? { "mip.context": envelope.context } : {}),
    ...(fingerprint ? { "mip.error_fingerprint": fingerprint } : {}),
  }) ?? false;
}

/**
 * Métriques de la collecte d'erreurs, voie par voie, depuis init() : occurrences
 * émises, tues par le plafond de page, refusées (beforeSend, consentement), et
 * API navigateur absentes. `null` tant que la collecte n'a pas démarré.
 */
export function getErrorCollectionStats(): ErrorCollectionStats | null {
  return errorStats?.() ?? null;
}

/**
 * Identifiant d'application de la session courante, ou "" si init() n'a pas
 * (encore) été appelé avec une configuration valide. Renseigné même quand la
 * collecte est ensuite refusée (DNT/GPC, session non échantillonnée) : le widget
 * d'avis s'en sert comme clé de stockage, et cette clé doit rester stable.
 */
export function appId(): string {
  return appIdValue;
}

/** Force the export of pending spans (used by tests and before unload). */
export function flush(): Promise<void> {
  drainErrors?.();
  return forceFlush();
}
