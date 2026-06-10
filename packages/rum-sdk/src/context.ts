let route = "/";

/** '/partners/42' -> '/partners/:id' (ids numériques, uuids, hashes longs). */
export function normalizeRoute(pathname: string): string {
  const normalized = pathname
    .split("/")
    .map((seg) => {
      if (/^\d+$/.test(seg)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
      if (/^[0-9a-f]{16,}$/i.test(seg)) return ":id";
      return seg;
    })
    .join("/");
  return normalized || "/";
}

export function currentRoute(): string {
  return route;
}

/** Retire query string et fragment (PII, PLAN §14). */
export function scrubUrl(url: string): string {
  return url.split("?")[0].split("#")[0];
}

/**
 * Pageview initiale + patch History API (SPA) : pushState/replaceState/popstate.
 */
export function initNavigation(onPageview: (navType: string) => void): void {
  route = normalizeRoute(location.pathname);
  const navEntry = performance.getEntriesByType?.(
    "navigation",
  )[0] as PerformanceNavigationTiming | undefined;
  onPageview(navEntry?.type ?? "navigate");

  const onRouteChange = () => {
    const next = normalizeRoute(location.pathname);
    if (next !== route) {
      route = next;
      onPageview("spa");
    }
  };
  const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
    function (this: unknown, ...args: never[]) {
      const ret = fn.apply(this, args);
      onRouteChange();
      return ret;
    } as T;
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  addEventListener("popstate", onRouteChange);
}
