// Long tasks (LIMITES §2) : span 'longtask' par tâche > 50 ms (seuil natif
// du Long Tasks API), cap 30/page.
import { makeCap, type PageCap } from "./caps";
import type { Emit } from "./errors";

export const LONGTASK_CAP_PER_PAGE = 30;

export function initLongTasks(emit: Emit): PageCap {
  const cap = makeCap(LONGTASK_CAP_PER_PAGE);
  if (typeof PerformanceObserver === "undefined") return cap;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!cap.take()) continue;
        emit("longtask", {
          "longtask.duration_ms": Math.round(entry.duration * 10) / 10,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    /* Long Tasks API absent (Safari) : on collecte sans */
  }
  return cap;
}
