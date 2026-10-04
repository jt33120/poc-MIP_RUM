import { initApiSpans } from "./apispans";
import { ActionTracker, actionAttrs, initAutomaticActions } from "./actions";
import { classeAppareil } from "./appareil";
import { createBreadcrumbTrail, initClickBreadcrumbs, MIP_UI_ATTR, type BreadcrumbTrail } from "./breadcrumbs";
import {
  accesTerminalAutorise,
  autoriserAccesTerminal,
  ConsentGate,
  effacerTerminal,
  type BufferedEvent,
} from "./consent";
import { currentRoute, initNavigation, scrubUrl } from "./context";
import {
  initConsoleErrors,
  initCspErrors,
  initResourceErrors,
  initWebSocketErrors,
  initWorkerErrors,
} from "./error-capture";
import { initEngagement } from "./engagement";
import { initErrors, type Emit } from "./errors";
import { initForms } from "./forms";
import { initFrustration, type FrustrationWatch } from "./frustration";
import { initLoaf } from "./loaf";
import { initLongTasks } from "./longtasks";
import { currentTraceId, discardPendingSpans, forceFlush, initOtel, newPageTrace } from "./otel";
import { flushReplayBoundary, isReplaySampled, startReplay } from "./replay";
import { DEFAULT_SLOW_RESOURCE_MS, initResources } from "./resources";
import { purgeRetryQueue, replayRetryQueue } from "./retry";
import { createSampler, decideMode, loadMode, storeMode, type SampleMode } from "./sampling";
import { readPrivacySignals, signalsOptOut } from "./privacy";
import { echue, getOrCreateSession, rotateSession, touchSession, type Session } from "./session";
import { decisionIdentite, marqueIdentite } from "./identite-session";
import type {
  AddErrorOptions,
  ErrorCategory,
  ErrorCollectionStats,
  MIPRumConfig,
} from "./types";
import { initNavTiming } from "./navtiming";
import { initSpaLoad } from "./spa-load";
import { initUserTimings } from "./user-timings";
import { initVitals } from "./vitals";
import { applyBeforeSend, validateIdentity } from "@mip/rum-core";
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
// Identités brutes, en mémoire seulement (HMAC côté serveur) ; seule leur marque
// est persistée avec la session (./identite-session.ts).
let identites: { user: string | null; account: string | null } = { user: null, account: null };
// Lu par le widget d'avis (MIPRum.appId()) pour cloisonner sa période de silence
// par application ; posé avant toute sortie anticipée d'init(), même en cas de refus.
let appIdValue = "";
let emitter: ((name: string, attrs: Parameters<Emit>[1], ts?: number) => boolean) | null = null;
let trail: BreadcrumbTrail | null = null;
let gate: ConsentGate | null = null;
let deliver: Emit | null = null; // émission réelle (post-consent)
let replayRetry: (() => void) | null = null;
let replayArm: (() => void) | null = null; // replay échantillonné, en attente de consent
let arreterReplay: (() => void) | null = null; // posé au démarrage du rejeu, appelé au refus
let drainErrors: (() => void) | null = null;
let resetErrors: (() => void) | null = null;
let markManualError: ((error: Error) => void) | null = null;
let errorStats: (() => ErrorCollectionStats) | null = null;
let causalActions: ActionTracker | null = null;
let collectionOrigin: (at?: number) => Record<string, string | number | boolean> = () => ({});
let updateCollectionConsent: ((granted: boolean) => void) | null = null;
// Posés par init(), appelés par consent() : l'accord ouvre le terminal et filtre le
// tampon (./consent.ts), le refus le referme.
let accorder: (() => ((tampon: readonly BufferedEvent[]) => readonly BufferedEvent[]) | undefined) | null = null;
let refuser: (() => void) | null = null;
// Page prérendue : l'outil de consentement y tourne déjà, sa décision est gardée
// pour le démarrage réel d'init().
let collecteDifferee = false;
let consentementEnAttente: boolean | null = null;

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

/** Contexte d'action puis contexte local d'erreur : le plus local gagne. */
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

/**
 * Hook public `beforeSend` (`@mip/rum-core`, commun avec React Native) : les champs SDK
 * restent immuables. Sans garde d'isolation : une exception du hook remonte à
 * l'appelant, comportement déjà en place chez les clients.
 */
export { applyBeforeSend };

/**
 * Draine les répétitions d'erreur exactement une fois avant chaque export (pagehide,
 * visibilitychange, navigation SPA, MIPRum.flush()). Exposé pour les tests.
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

// Capturé au chargement : document.currentScript est nul ensuite. Sert à charger
// mip-rum-feedback.js depuis le dossier du SDK.
const sdkScriptSrc =
  typeof document !== "undefined"
    ? ((document.currentScript as HTMLScriptElement | null)?.src ?? null)
    : null;

/** Charge le widget d'avis depuis l'origine du SDK ; idempotent (__mipRumFeedbackMounted). */
function loadFeedbackWidget(opt: boolean | { label?: string; accent?: string }): void {
  if (typeof document === "undefined") return;
  const w = window as unknown as { __mipRumFeedbackMounted?: boolean; MIPRumFeedback?: unknown };
  if (w.__mipRumFeedbackMounted) return;
  // { label, accent } avant chargement ; sinon la configuration posée par la page.
  const base = opt && typeof opt === "object" ? opt : w.MIPRumFeedback;
  // Le widget garde sa période de silence dans le stockage local : il reçoit
  // l'interrupteur du SDK pour ne pas y toucher avant l'accord (finding 1.11).
  w.MIPRumFeedback = { ...(base && typeof base === "object" ? base : {}), stockageAutorise: accesTerminalAutorise };
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
  // DNT/GPC : rien n'est collecté. `honorDNT: false` pour les apps dont le
  // consentement affirmatif (MIPRum.consent()) prime le signal.
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
  // Une page prérendue (Speculation Rules) peut ne jamais être affichée : la collecte
  // attend `prerenderingchange`, sans session ni écriture d'ici là (finding 2.5).
  if (typeof document !== "undefined" && (document as { prerendering?: boolean }).prerendering === true) {
    if (!collecteDifferee) {
      collecteDifferee = true;
      document.addEventListener("prerenderingchange", () => init(cfg), { once: true });
    }
    return;
  }
  // Avec `requireConsent`, rien sur le terminal avant l'accord : session et visiteur
  // vivent en mémoire, l'échantillonnage se décide dans `accorder` (finding 1.11).
  const accordAttendu = Boolean(cfg.requireConsent);
  autoriserAccesTerminal(!accordAttendu);
  let sessionEnMemoire = accordAttendu;
  // Échantillonnage tiré par session et persisté, stable d'une page à l'autre ;
  // "off" : rien n'est collecté.
  session = reconcilierIdentites(getOrCreateSession());
  let mode0: SampleMode = "full"; // en attente d'accord : provisoire, tout va au tampon
  if (!accordAttendu) {
    mode0 = loadMode(session.sessionId) ?? decideMode(cfg);
    storeMode(session.sessionId, mode0);
    if (mode0 === "off") {
      session = null;
      return;
    }
  }
  initialized = true;
  // promotion "error-biased" -> "full" persistée (la session reste "full" après reload)
  const promouvoir = () => storeMode(session!.sessionId, "full");
  let sampler = createSampler(mode0, promouvoir);

  /**
   * Changement de session sans rechargement : l'action en cours et le morceau de rejeu
   * se closent AVANT, sous l'ancienne. La suivante hérite du mode d'échantillonnage,
   * sinon la page suivante le retirerait au sort.
   */
  const passerA = (nouvelle: Session): Session => {
    const avant = session;
    if (avant && avant.sessionId !== nouvelle.sessionId) {
      causalActions?.close();
      flushReplayBoundary();
      if (loadMode(nouvelle.sessionId) == null) storeMode(nouvelle.sessionId, sampler.mode ?? mode0);
    }
    session = nouvelle;
    return nouvelle;
  };

  // Une session échoit après 4 h ou 30 min sans événement (./session.ts, finding 2.12 b).
  // La suite se cherche d'abord dans le stockage : un autre onglet a pu l'ouvrir, et
  // en tirer une ici ferait une session par onglet.
  const sessionCourante = (): Session => {
    const s = session!;
    if (!echue(s, Date.now())) return s;
    return passerA(reconcilierIdentites(getOrCreateSession(s)));
  };

  // Identifiants mémoire remplacés à l'accord par ceux du stockage : un effet tardif
  // qui porte l'ancien est réécrit à l'envoi, sans session fantôme.
  const renommes = new Map<string, string>();
  const renommer = (attrs: Record<string, unknown>): Record<string, unknown> => {
    if (renommes.size === 0) return attrs;
    for (const cle of ["mip.session_id", "mip.visitor_id"]) {
      const v = attrs[cle];
      if (typeof v === "string" && renommes.has(v)) attrs[cle] = renommes.get(v)!;
    }
    return attrs;
  };

  const tracer = initOtel(cfg);
  // Le pays se déduit du fuseau à l'ingestion : aucune IP stockée.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Lue une fois : ni l'user-agent ni l'écran tactile ne changent (finding 2.13).
  const appareil = classeAppareil(navigator.userAgent, navigator.maxTouchPoints ?? 0);

  // `ts` : rejeu consent/retry. Un appel réseau dure `http.duration_ms`, pour une
  // cascade lisible dans un backend tiers (finding 1.4) ; le reste est instantané.
  const realEmit: Emit = (name, attrs, ts) => {
    const debut = ts ?? Date.now();
    const duree = name === "http.client" ? attrs["http.duration_ms"] : 0;
    const span = tracer.startSpan(name, { startTime: debut });
    span.setAttributes(attrs as Record<string, string | number>);
    span.end(typeof duree === "number" && duree > 0 ? debut + duree : debut);
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
  // "error-biased" : seules les erreurs passent, la première promeut la session en
  // "full". Les émetteurs rendent true si l'événement est livré ou retenu, false s'il
  // est jeté ; `Emit` déclare `void`, un booléen lui reste assignable.
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
    const current = sessionCourante();
    touchSession(current);
    const envelope = eventContext.envelope();
    const snapshotted: Record<string, unknown> = {
      "mip.session_id": current.sessionId,
      "mip.visitor_id": current.visitorId,
      "mip.route": currentRoute(),
      "mip.tz": tz,
      "mip.device_type": appareil,
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
    const outbound = renommer({ ...attrs });
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
    // La session échue tourne ICI, avant que l'action soit courante : plus tard, elle
    // la fermerait à peine ouverte et la racine partirait sous l'ancienne session.
    rootSnapshot: (context) => {
      const current = sessionCourante();
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
      // beforeSend a pu pseudonymiser le libellé : ne jamais recopier le texte DOM
      // d'avant le hook, la jointure action_id le restitue filtré.
      frustrationWatch?.error?.(causalOnly(prepared), "action", ts);
    }
    return submitBase(name, prepared, ts);
  };
  emitter = emit;

  trail = createBreadcrumbTrail(emit);
  // Temps passé, défilement et poids de chaque vue ; les ressources le nourrissent.
  const engagement = initEngagement(emit);
  const resourceCap = initResources(emit, {
    slowResourceMs: cfg.slowResourceMs ?? DEFAULT_SLOW_RESOURCE_MS,
    endpoint: cfg.endpoint,
    all: cfg.resources === "all",
    onEntry: engagement.ressource,
    actionAt: (at) => ({ ...collectionOrigin(at), ...actionAttrs(causalActions!.atTimestamp(at)) }),
  });
  // LoAF sinon Long Tasks, jamais les deux : un blocage produirait une entrée de
  // chaque côté. LoAF nomme en plus le script responsable.
  const longtaskCap = initLoaf(emit) ?? initLongTasks(emit);
  // Ordre volontaire : la racine s'ouvre avant le breadcrumb du même clic.
  initAutomaticActions(causalActions);
  initClickBreadcrumbs(trail, () => actionAttrs(causalActions!.current()));
  // Rage et dead clicks ; opt-out par cfg.frustration=false
  frustrationWatch = initFrustration(emit, {
    enabled: cfg.frustration !== false,
    action: () => ({ ...collectionOrigin(), ...actionAttrs(causalActions!.origin()) }),
  });
  initVitals(emit);
  // Décomposition réseau (DNS/TCP/TLS/requête/réponse) + qualité du lien : la
  // CAUSE derrière le TTFB, qui n'en donnait que le symptôme.
  initNavTiming(emit);
  const userTimings = cfg.userTimings !== false ? initUserTimings(emit) : null;
  // Instrumentation champ par champ ; opt-out par cfg.forms=false
  if (cfg.forms !== false) initForms(emit);

  // Chaque erreur laisse aussi un breadcrumb. `errorCap` plafonne par page et
  // déduplique par empreinte (finding 2.1).
  const errorCap = initErrors((name, attrs, ts) => {
    if (!emit(name, attrs, ts)) return false;
    // Seule l'enveloppe figée à l'occurrence est recopiée (jamais message ni stack) :
    // un drain après un nouveau clic ne la rattache pas à l'action courante.
    trail?.add(
      "error",
      String(attrs["exception.message"] ?? "error"),
      causalActions!.validate(causalOnly(attrs)),
    );
    return true;
  }, Date.now, (at) => {
    // Enveloppe figée à l'occurrence : un drain après changement de contexte ou
    // d'identité ne doit pas la réétiqueter.
    const current = sessionCourante();
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

  // Chaque voie est opt-in et passe par errorCap ; la voie réseau vit dans les
  // wrappers du tracing, sans lesquels elle n'existe pas.
  const capture = cfg.captureErrors ?? {};
  const network = cfg.trace !== false ? capture.network : undefined;
  const enabled: Record<ErrorCategory, boolean> = {
    uncaught: true,
    console: Boolean(capture.console),
    resources: Boolean(capture.resources),
    csp: Boolean(capture.csp),
    network: Boolean(network),
    workers: capture.workers !== false,
    websockets: capture.websockets !== false,
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
    workers: enabled.workers ? initWorkerErrors(errorCap) : [],
    websockets: enabled.websockets ? initWebSocketErrors(errorCap, denyOrigins) : [],
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

  // Tracing distribué : fetch/XHR -> traceparent + span 'http.client'.
  let apiCap: ReturnType<typeof initApiSpans> | null = null;
  if (cfg.trace !== false) {
    apiCap = initApiSpans(emit, {
      extraOrigins: Array.isArray(cfg.trace)
        ? cfg.trace.map((o) => o.replace(/\/+$/, ""))
        : [],
      denyOrigins,
      // `tracestate` part avec la session où la requête naît, échéance comprise.
      sessionId: () => sessionCourante().sessionId,
      // Session hors échantillon (tirage « off » à l'accord) : ni en-tête ni span.
      actif: () => sampler.mode !== "off",
      traceId: currentTraceId, // même trace que la page vue
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

  // Fin de chargement des vues SPA ; ses requêtes suivies hors ingestion MIP.
  const spaLoad = initSpaLoad(emit, { denyOrigins });

  initNavigation((navType) => {
    // La vue qui finit part d'abord avec son cumul et sa route. La vue initiale part
    // du début de la navigation (de l'affichage, pour une page prérendue).
    const debutVue = navType === "spa" || navType === "bfcache" ? performance.now() : debutNavigation();
    engagement.nouvelleVue(currentRoute(), debutVue);
    spaLoad?.nouvelleVue(navType === "spa" ? { route: currentRoute(), id: engagement.vueId(), debut: debutVue } : null);
    userTimings?.nouvelleVue(debutVue);
    // Après le bfcache, la session a pu échoir : comme un chargement (finding 2.5).
    if (navType === "bfcache") passerA(reconcilierIdentites(getOrCreateSession(session!)));
    causalActions!.close();
    // Une trace W3C par page vue, ouverte AVANT le span pageview : borne la taille des traces.
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

  // Rejeu tiré à l'init, démarré à l'accord (bundle mip-rum-replay.js chargé à la
  // demande), jamais pour une session hors échantillon.
  replayArm = isReplaySampled(cfg.replay)
    ? () => {
        if (sampler.mode !== "off") arreterReplay = startReplay(cfg, () => session!.sessionId) ?? null;
      }
    : null;

  /**
   * L'accord reprend la session du stockage (consentie sur une page précédente) ou y
   * écrit celle de la mémoire, puis tire le mode, appliqué au tampon d'un bloc :
   * « full » tout part ; « error-biased » tout part s'il porte une erreur (session
   * promue), rien sinon ; « off » rien, ni la suite de la page.
   */
  accorder = () => {
    autoriserAccesTerminal(true);
    if (!sessionEnMemoire) return undefined;
    sessionEnMemoire = false;
    const memoire = session!;
    session = reconcilierIdentites(getOrCreateSession(memoire));
    const mode = loadMode(session.sessionId) ?? decideMode(cfg);
    storeMode(session.sessionId, mode);
    sampler = createSampler(mode, promouvoir);
    if (memoire.sessionId !== session.sessionId) renommes.set(memoire.sessionId, session.sessionId);
    if (memoire.visitorId !== session.visitorId) renommes.set(memoire.visitorId, session.visitorId);
    return (tampon) => {
      let retenus: readonly BufferedEvent[] = [];
      if (mode === "full") retenus = tampon;
      else if (mode === "error-biased" && tampon.some((e) => e.name === "exception")) {
        sampler.notifyError();
        retenus = tampon;
      }
      // Une action dont la racine n'est pas partie ne doit plus recevoir d'effets.
      if (retenus.length < tampon.length || renommes.size > 0) causalActions?.close();
      return retenus.map((e) => ({ ...e, attrs: renommer({ ...e.attrs }) as BufferedEvent["attrs"] }));
    };
  };

  /**
   * Le refus referme le terminal et efface ce que le SDK y avait posé (la file de
   * rejeu : `purgeRetryQueue`). La page continue en mémoire ; un nouvel accord
   * l'écrira sous un nouveau visiteur.
   */
  refuser = () => {
    autoriserAccesTerminal(false);
    effacerTerminal();
    sessionEnMemoire = true;
    renommes.clear();
    session = getOrCreateSession();
  };

  if (gate.granted) {
    replayRetry();
    replayArm?.();
  }

  // Ses envois passent par MIPRum.track('feedback'), donc par le consentement.
  if (cfg.feedback) loadFeedbackWidget(cfg.feedback);

  // Accord ou refus donné pendant le prérendu : appliqué maintenant.
  if (consentementEnAttente !== null) {
    const decision = consentementEnAttente;
    consentementEnAttente = null;
    consent(decision);
  }
}

/** Début de la vue initiale en temps `performance` : 0, ou l'affichage d'une page prérendue. */
function debutNavigation(): number {
  const nav = performance.getEntriesByType?.("navigation")[0] as { activationStart?: number } | undefined;
  return typeof nav?.activationStart === "number" && nav.activationStart > 0 ? nav.activationStart : 0;
}

/**
 * RGPD : consent(true) débloque la collecte et rejoue le tampon et la file retry ;
 * consent(false) purge, désactive et efface le stockage local du SDK.
 */
export function consent(granted: boolean): void {
  if (!gate || !deliver) {
    // Page prérendue : init() attend l'affichage, la décision l'attend avec lui.
    if (collecteDifferee && !initialized) consentementEnAttente = granted;
    return; // init() non appelé ou session non échantillonnée
  }
  updateCollectionConsent?.(granted);
  causalActions?.consent(granted);
  if (!granted) {
    // Erreurs compactées et file offline aussi : un refus explicite les rend
    // irrécupérables, au lieu de les rejouer au ré-accord.
    resetErrors?.();
    purgeRetryQueue();
    discardPendingSpans();
    // Sinon rrweb enregistre et poste encore jusqu'à 2 minutes après le refus.
    arreterReplay?.();
    refuser?.();
  } else {
    // Les occurrences vues pendant une période explicitement refusée ne
    // doivent ni retarder ni grossir la première erreur post-réaccord.
    resetErrors?.();
  }
  gate.set(granted, deliver, granted ? accorder?.() : undefined);
  if (granted) {
    replayRetry?.();
    replayArm?.(); // replay en attente de consent : démarre maintenant
  }
}

/**
 * Événement métier : MIPRum.track("partner_search", {results: 12}) émet un span
 * 'track.<name>' (mip.props en JSON) et un breadcrumb 'custom'.
 */
export function track(
  name: string,
  props: Record<string, unknown> = {},
  context: EventContext = {},
): boolean {
  // true : parti ou retenu jusqu'à l'accord, pas « accepté par l'API ». false : jeté
  // (sans init, DNT/GPC, session "off" ou "error-biased"). À consulter avant
  // d'afficher une confirmation.
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

/**
 * Confronte les identités posées avant `init()` à la session reprise. Une identité
 * vide n'est pas une déconnexion : la page ne l'a pas encore reposée.
 */
function reconcilierIdentites(s: Session): Session {
  const marques = { ...s.identites };
  let rotation = false;
  for (const genre of ["user", "account"] as const) {
    const id = identites[genre];
    if (id === null) continue;
    const apres = marqueIdentite(s.sessionId, genre, id);
    const decision = decisionIdentite(s.identites?.[genre], apres);
    if (decision === "rotation") rotation = true;
    else if (decision === "rattacher") marques[genre] = apres;
  }
  if (rotation) return rotateSession(s.visitorId, identites);
  s.identites = marques;
  touchSession(s);
  return s;
}

/** Changement d'identité : rien, rattachement ou rotation (./identite-session.ts). */
function appliquerIdentite(genre: "user" | "account", id: string | null): void {
  identites = { ...identites, [genre]: id };
  if (!initialized || !session) return; // init() rattachera
  const apres = marqueIdentite(session.sessionId, genre, id);
  const decision = decisionIdentite(session.identites?.[genre], apres);
  if (decision === "rien") return;
  if (decision === "rattacher") {
    session.identites = { ...session.identites, [genre]: apres };
    touchSession(session);
    return;
  }
  drainErrors?.();
  resetErrors?.();
  causalActions?.close();
  flushReplayBoundary();
  session = rotateSession(session.visitorId, identites);
}

/** Définit ou efface l'identité utilisateur métier. L'identifiant brut reste en mémoire. */
export function setUser(user: string | IdentityInput | null): void {
  const valide = validateIdentity(user);
  // Une entrée refusée ne change rien — surtout pas une « déconnexion ».
  if (valide === undefined) return;
  eventContext.setUser(user);
  appliquerIdentite("user", valide === null ? null : valide.id);
}

export function clearUser(): void { setUser(null); }

/** Définit ou efface l'identité compte métier. L'identifiant brut reste en mémoire. */
export function setAccount(account: string | IdentityInput | null): void {
  const valide = validateIdentity(account);
  if (valide === undefined) return;
  eventContext.setAccount(account);
  appliquerIdentite("account", valide === null ? null : valide.id);
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
 * Signale une erreur par la voie exception. `options.fingerprint` (≤ 100 caractères)
 * prime dans le regroupement des issues ; invalide, elle est ignorée, pas l'erreur.
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
 * Compteurs de la collecte d'erreurs par voie depuis init() (émises, plafonnées,
 * refusées, API absentes) ; `null` avant le démarrage.
 */
export function getErrorCollectionStats(): ErrorCollectionStats | null {
  return errorStats?.() ?? null;
}

/**
 * appId courant, ou "" avant un init() valide. Posé même si la collecte est refusée :
 * le widget d'avis en fait une clé de stockage stable.
 */
export function appId(): string {
  return appIdValue;
}

/** Force l'export des spans en attente (tests, avant déchargement). */
export function flush(): Promise<void> {
  drainErrors?.();
  return forceFlush();
}
