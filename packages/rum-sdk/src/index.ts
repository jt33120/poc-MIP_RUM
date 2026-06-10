import { currentRoute, initNavigation, scrubUrl } from "./context";
import { initErrors, type Emit } from "./errors";
import { forceFlush, initOtel } from "./otel";
import { getOrCreateSession, touchSession, type Session } from "./session";
import type { MIPRumConfig } from "./types";
import { initVitals } from "./vitals";

let session: Session | null = null;
let initialized = false;
let emitter: Emit | null = null;

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

  const emit: Emit = (name, attrs) => {
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
    const span = tracer.startSpan(name);
    span.setAttributes(merged as Record<string, string | number>);
    span.end();
    // INP/CLS finals arrive pendant le passage en hidden : flush immédiat
    // pour que le beacon parte avant l'unload
    if (document.visibilityState === "hidden") forceFlush().catch(() => {});
  };
  emitter = emit;

  initVitals(emit);
  initErrors(emit);
  initNavigation((navType) =>
    emit("pageview", {
      "mip.url": scrubUrl(location.href),
      "mip.referrer": scrubUrl(document.referrer),
      "mip.nav_type": navType,
    }),
  );
}

/**
 * Événement métier optionnel : MIPRum.track("partner_search", {results: 12}).
 * Émis comme span 'track.<name>' — ignoré par l'ingestion POC (prouve
 * l'extensibilité du fil OTLP sans toucher au backend).
 */
export function track(name: string, props: Record<string, string | number> = {}): void {
  emitter?.(`track.${name}`, props);
}

/** Force the export of pending spans (used by tests and before unload). */
export function flush(): Promise<void> {
  return forceFlush();
}
