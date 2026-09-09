import { initApiSpans } from "./apispans";
import { createBreadcrumbTrail, initClickBreadcrumbs, type BreadcrumbTrail } from "./breadcrumbs";
import { ConsentGate } from "./consent";
import { currentRoute, initNavigation, scrubUrl } from "./context";
import { initErrors, type Emit } from "./errors";
import { initForms } from "./forms";
import { initFrustration } from "./frustration";
import { initLoaf } from "./loaf";
import { initLongTasks } from "./longtasks";
import { currentTraceId, forceFlush, initOtel, newPageTrace } from "./otel";
import { isReplaySampled, startReplay } from "./replay";
import { DEFAULT_SLOW_RESOURCE_MS, initResources } from "./resources";
import { replayRetryQueue } from "./retry";
import { createSampler, decideMode, loadMode, storeMode } from "./sampling";
import { readPrivacySignals, signalsOptOut } from "./privacy";
import { getOrCreateSession, touchSession, type Session } from "./session";
import type { MIPRumConfig } from "./types";
import { initNavTiming } from "./navtiming";
import { initVitals } from "./vitals";

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
    touchSession(session!);
    let merged: Record<string, unknown> = {
      "mip.session_id": session!.sessionId,
      // `mip.user_hash` N'EST PLUS ÉMIS : c'était une empreinte de terminal
      // (cf. session.ts). L'ingestion l'accepte encore des SDK déjà déployés.
      "mip.visitor_id": session!.visitorId,
      "mip.route": currentRoute(),
      "mip.tz": tz,
      "mip.device_type": /mobile|tablet/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop",
      // Ext-A : étiquette du capteur ('sdk' par défaut ; 'extension' quand le SDK
      // est injecté par l'extension navigateur). Persisté sur rum_session.
      "mip.collection_source": cfg.collectionSource === "extension" ? "extension" : "sdk",
      ...attrs,
    };
    if (cfg.beforeSend) {
      const filtered = cfg.beforeSend(merged);
      if (!filtered) return;
      merged = filtered;
    }
    const span =
      ts != null ? tracer.startSpan(name, { startTime: ts }) : tracer.startSpan(name);
    span.setAttributes(merged as Record<string, string | number>);
    if (ts != null) span.end(ts);
    else span.end();
    // INP/CLS finals arrivent pendant le passage en hidden : flush immédiat
    // pour que le beacon parte avant l'unload
    if (document.visibilityState === "hidden") forceFlush().catch(() => {});
  };
  deliver = realEmit;

  // consent mode : tout passe par la gate (0 span créé => 0 requête réseau)
  gate = new ConsentGate(cfg.requireConsent ?? false);
  // échantillonnage : en "error-biased", seules les erreurs passent ; la 1re
  // erreur promeut la session en "full" (le reste de la session est alors capté).
  // Renvoie true si l'événement a été PRIS EN CHARGE (livré ou bufferisé en
  // attente de consentement), false s'il a été jeté — par l'échantillonnage ou
  // par un refus de consentement. `Emit` déclare `void` : un retour booléen lui
  // reste assignable, et les appelants qui l'ignorent ne changent pas.
  const emit = (name: string, attrs: Parameters<Emit>[1], ts?: number): boolean => {
    if (name === "exception") sampler.notifyError();
    if (!sampler.passes(name)) return false;
    return gate!.submit(name, attrs, realEmit, ts);
  };
  emitter = emit;

  trail = createBreadcrumbTrail(emit);
  const resourceCap = initResources(emit, {
    slowResourceMs: cfg.slowResourceMs ?? DEFAULT_SLOW_RESOURCE_MS,
    endpoint: cfg.endpoint,
  });
  // Blocage du fil principal : LoAF si le navigateur le connaît, Long Tasks
  // sinon. JAMAIS LES DEUX — un même blocage produit une entrée de chaque côté,
  // et les compter tous les deux doublerait le nombre de blocages affiché. LoAF
  // est le successeur : il porte en plus le script responsable, ce qui est la
  // seule information dont on puisse faire un correctif.
  const longtaskCap = initLoaf(emit) ?? initLongTasks(emit);
  initClickBreadcrumbs(trail);
  // signaux de frustration (P1) : rage/dead clicks ; opt-out via cfg.frustration=false
  const frustrationCap = initFrustration(emit, { enabled: cfg.frustration !== false });
  initVitals(emit);
  // Décomposition réseau (DNS/TCP/TLS/requête/réponse) + qualité du lien : la
  // CAUSE derrière le TTFB, qui n'en donnait que le symptôme.
  initNavTiming(emit);
  // form analytics (Lot 7) : instrumentation champ par champ ; opt-out via cfg.forms=false
  if (cfg.forms !== false) initForms(emit);

  // tracing distribué (v0.4) : fetch/XHR -> traceparent + span 'http.client'.
  // Les endpoints d'ingestion MIP sont exclus (pas de boucle SDK -> SDK).
  let apiCap: ReturnType<typeof initApiSpans> | null = null;
  if (cfg.trace !== false) {
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
    apiCap = initApiSpans(emit, {
      extraOrigins: Array.isArray(cfg.trace)
        ? cfg.trace.map((o) => o.replace(/\/+$/, ""))
        : [],
      denyOrigins,
      sessionId: session.sessionId,
      traceId: currentTraceId, // même trace que la page vue (E0)
    });
  }

  // chaque erreur laisse aussi un breadcrumb (parcours menant à l'erreur)
  initErrors((name, attrs) => {
    emit(name, attrs);
    trail?.add("error", String(attrs["exception.message"] ?? "error"));
  });

  initNavigation((navType) => {
    // nouvelle page vue = nouvelle trace W3C (E0) : ouverte AVANT le span
    // pageview pour qu'il en soit le premier span. Borne la taille des traces.
    newPageTrace();
    // caps par page : remis à zéro à chaque pageview (initiale et SPA)
    resourceCap.reset();
    longtaskCap.reset();
    apiCap?.reset();
    frustrationCap.reset();
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
    ? () => startReplay(cfg, session!.sessionId)
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
export function track(name: string, props: Record<string, unknown> = {}): boolean {
  // Le retour dit si l'événement est PARTI (ou a été bufferisé pour partir), et
  // non s'il a été « accepté par l'API ». false = jeté avant toute émission :
  // init() jamais appelé, opt-out DNT/GPC, session "off", ou mode
  // "error-biased" — où seules les erreurs passent. Un appelant qui affiche une
  // confirmation à l'utilisateur DOIT le consulter : sans lui, le widget d'avis
  // annonçait « envoyé » sur un avis silencieusement jeté.
  const accepted = emitter?.(`track.${name}`, { "mip.props": JSON.stringify(props) }) ?? false;
  trail?.add("custom", name);
  return accepted;
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
  return forceFlush();
}
