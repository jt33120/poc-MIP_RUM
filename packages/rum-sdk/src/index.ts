import { createBreadcrumbTrail, initClickBreadcrumbs, type BreadcrumbTrail } from "./breadcrumbs";
import { ConsentGate } from "./consent";
import { currentRoute, initNavigation, scrubUrl } from "./context";
import { initErrors, type Emit } from "./errors";
import { initLongTasks } from "./longtasks";
import { forceFlush, initOtel } from "./otel";
import { DEFAULT_SLOW_RESOURCE_MS, initResources } from "./resources";
import { replayRetryQueue } from "./retry";
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

export function init(cfg: MIPRumConfig): void {
  if (initialized) return;
  if (!cfg || !cfg.endpoint || !cfg.appId) {
    console.warn("[MIPRum] init: endpoint and appId are required");
    return;
  }
  if (Math.random() >= (cfg.sampleRate ?? 1.0)) return; // session not sampled
  initialized = true;

  session = getOrCreateSession();
  const tracer = initOtel(cfg);

  // émission réelle : crée le span OTel (ts optionnel = rejeu consent/retry)
  const realEmit: Emit = (name, attrs, ts) => {
    touchSession(session!);
    let merged: Record<string, unknown> = {
      "mip.session_id": session!.sessionId,
      "mip.user_hash": session!.userHash,
      "mip.route": currentRoute(),
      "mip.device_type": /mobile|tablet/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop",
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
  const emit: Emit = (name, attrs, ts) => gate!.submit(name, attrs, realEmit, ts);
  emitter = emit;

  trail = createBreadcrumbTrail(emit);
  const resourceCap = initResources(emit, {
    slowResourceMs: cfg.slowResourceMs ?? DEFAULT_SLOW_RESOURCE_MS,
    endpoint: cfg.endpoint,
  });
  const longtaskCap = initLongTasks(emit);
  initClickBreadcrumbs(trail);
  initVitals(emit);

  // chaque erreur laisse aussi un breadcrumb (parcours menant à l'erreur)
  initErrors((name, attrs) => {
    emit(name, attrs);
    trail?.add("error", String(attrs["exception.message"] ?? "error"));
  });

  initNavigation((navType) => {
    // caps par page : remis à zéro à chaque pageview (initiale et SPA)
    resourceCap.reset();
    longtaskCap.reset();
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
  if (gate.granted) replayRetry();
}

/**
 * Consent mode RGPD : MIPRum.consent(true) débloque la collecte et rejoue le
 * buffer mémoire (+ la file retry) ; consent(false) purge et désactive.
 */
export function consent(granted: boolean): void {
  if (!gate || !deliver) return; // init() non appelé ou session non échantillonnée
  gate.set(granted, deliver);
  if (granted) replayRetry?.();
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
