import { forceFlush, initOtel } from "./otel";
import { getOrCreateSession, touchSession, type Session } from "./session";
import type { MIPRumConfig } from "./types";
import { initVitals } from "./vitals";

let session: Session | null = null;
let initialized = false;

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

  const baseAttrs = () => {
    touchSession(session!);
    return {
      "mip.session_id": session!.sessionId,
      "mip.user_hash": session!.userHash,
      "mip.route": location.pathname,
      "mip.device_type": /mobile|tablet/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop",
    };
  };

  initVitals(tracer, baseAttrs);
}

/** Force the export of pending spans (used by tests and before unload). */
export function flush(): Promise<void> {
  return forceFlush();
}
