// Resource timings (LIMITES §2) : un span 'resource' par ressource lente
// (duration >= slowResourceMs) OU render-blocking, cap 20/page.
import { makeCap, type PageCap } from "./caps";
import { scrubUrl } from "./context";
import type { Emit } from "./errors";

export const RESOURCE_CAP_PER_PAGE = 20;
export const DEFAULT_SLOW_RESOURCE_MS = 300;

export function initResources(
  emit: Emit,
  opts: {
    slowResourceMs: number;
    endpoint: string;
    actionAt?: (epochMs: number) => Record<string, string | number | boolean>;
  },
): PageCap {
  const cap = makeCap(RESOURCE_CAP_PER_PAGE);
  if (typeof PerformanceObserver === "undefined") return cap;
  const endpointBase = scrubUrl(opts.endpoint);
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        // exclut les exports OTLP du SDK lui-même (boucle de rétroaction)
        if (entry.name.startsWith(endpointBase) || entry.name.includes("/v1/traces")) continue;
        const blocking =
          (entry as { renderBlockingStatus?: string }).renderBlockingStatus === "blocking";
        if (entry.duration < opts.slowResourceMs && !blocking) continue;
        if (!cap.take()) continue;
        const origin = Number.isFinite(performance.timeOrigin)
          ? performance.timeOrigin
          : Date.now() - performance.now();
        const startedAt = origin + entry.startTime;
        emit("resource", {
          ...(opts.actionAt?.(startedAt) ?? {}),
          "resource.url": scrubUrl(entry.name),
          "resource.type": entry.initiatorType || "other",
          "resource.duration_ms": Math.round(entry.duration * 10) / 10,
          "resource.transfer_size": entry.transferSize ?? 0,
          "resource.render_blocking": blocking,
        }, startedAt);
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    /* type 'resource' non supporté : on collecte sans */
  }
  return cap;
}
