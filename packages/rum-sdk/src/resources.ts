// Un span 'resource' par ressource lente (>= slowResourceMs) ou bloquant le rendu ;
// toutes avec `resources: "all"`. Chaque entrée nourrit aussi le résumé de la vue.
import { makeCap, type PageCap } from "./caps";
import { scrubUrl } from "./context";
import type { Emit } from "./errors";

export const RESOURCE_CAP_PER_PAGE = 20;
/** Plafond de `resources: "all"` : une page riche en charge des centaines. */
export const RESOURCE_CAP_ALL = 150;
export const DEFAULT_SLOW_RESOURCE_MS = 300;

export function initResources(
  emit: Emit,
  opts: {
    slowResourceMs: number;
    endpoint: string;
    actionAt?: (epochMs: number) => Record<string, string | number | boolean>;
    /** Toutes les ressources, pas seulement les lentes. */
    all?: boolean;
    /** Chaque ressource de l'app, exports MIP exclus, avant tout filtre. */
    onEntry?: (entry: PerformanceResourceTiming) => void;
  },
): PageCap {
  const cap = makeCap(opts.all ? RESOURCE_CAP_ALL : RESOURCE_CAP_PER_PAGE);
  if (typeof PerformanceObserver === "undefined") return cap;
  const endpointBase = scrubUrl(opts.endpoint);
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        // Pas les exports du SDK lui-même : boucle de rétroaction.
        if (entry.name.startsWith(endpointBase) || entry.name.includes("/v1/traces")) continue;
        opts.onEntry?.(entry);
        const blocking =
          (entry as { renderBlockingStatus?: string }).renderBlockingStatus === "blocking";
        if (!opts.all && entry.duration < opts.slowResourceMs && !blocking) continue;
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
