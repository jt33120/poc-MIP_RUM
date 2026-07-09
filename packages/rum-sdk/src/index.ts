import { initApiSpans } from "./apispans";
import { createBreadcrumbTrail, initClickBreadcrumbs, type BreadcrumbTrail } from "./breadcrumbs";
import { ConsentGate } from "./consent";
import { currentRoute, initNavigation, scrubUrl } from "./context";
import { initErrors, type Emit } from "./errors";
import { initForms } from "./forms";
import { initFrustration } from "./frustration";
import { initLongTasks } from "./longtasks";
import { forceFlush, initOtel } from "./otel";
import { isReplaySampled, startReplay } from "./replay";
import { DEFAULT_SLOW_RESOURCE_MS, initResources } from "./resources";
import { replayRetryQueue } from "./retry";
import { createSampler, decideMode, loadMode, storeMode } from "./sampling";
import { readPrivacySignals, signalsOptOut } from "./privacy";
import { getOrCreateSession, touchSession, type Session } from "./session";
import type { MIPRumConfig } from "./types";
import { initVitals } from "./vitals";

let session: Session | null = null;
let initialized = false;
let emitter: Emit | null = null;
let trail: BreadcrumbTrail | null = null;
let gate: ConsentGate | null = null;
let deliver: Emit | null = null; // émission réelle (post-consent)
let replayRetry: (() => void) | null = null;
let replayArm: (() => void) | null = null; // replay échantillonné, en attente de consent

export function init(cfg: MIPRumConfig): void {
  if (initialized) return;
  if (!cfg || !cfg.endpoint || !cfg.appId) {
    console.warn("[MIPRum] init: endpoint and appId are required");
    return;
  }
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
      "mip.user_hash": session!.userHash,
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
  const emit: Emit = (name, attrs, ts) => {
    if (name === "exception") sampler.notifyError();
    if (!sampler.passes(name)) return;
    gate!.submit(name, attrs, realEmit, ts);
  };
  emitter = emit;

  trail = createBreadcrumbTrail(emit);
  const resourceCap = initResources(emit, {
    slowResourceMs: cfg.slowResourceMs ?? DEFAULT_SLOW_RESOURCE_MS,
    endpoint: cfg.endpoint,
  });
  const longtaskCap = initLongTasks(emit);
  initClickBreadcrumbs(trail);
  // signaux de frustration (P1) : rage/dead clicks ; opt-out via cfg.frustration=false
  const frustrationCap = initFrustration(emit, { enabled: cfg.frustration !== false });
  initVitals(emit);
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
    });
  }

  // chaque erreur laisse aussi un breadcrumb (parcours menant à l'erreur)
  initErrors((name, attrs) => {
    emit(name, attrs);
    trail?.add("error", String(attrs["exception.message"] ?? "error"));
  });

  initNavigation((navType) => {
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
export function track(name: string, props: Record<string, unknown> = {}): void {
  emitter?.(`track.${name}`, { "mip.props": JSON.stringify(props) });
  trail?.add("custom", name);
}

/** Force the export of pending spans (used by tests and before unload). */
export function flush(): Promise<void> {
  return forceFlush();
}
