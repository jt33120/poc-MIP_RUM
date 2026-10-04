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

/** Retire query string et fragment (PII, PLAN §14) ; `user:pass@` devient `REDACTED:REDACTED@` (convention `url.full`). */
export function scrubUrl(url: string): string {
  return url.split("?")[0].split("#")[0].replace(/^([a-z][a-z\d+.-]*:\/\/)[^/@]*@/i, "$1REDACTED:REDACTED@");
}

/**
 * Type de la navigation initiale ; `prerender` si `activationStart` > 0, comme
 * web-vitals (ses temps se comptent alors depuis l'affichage).
 */
export function typeNavigationInitiale(entree: PerformanceNavigationTiming | undefined): string {
  const activation = (entree as { activationStart?: number } | undefined)?.activationStart;
  if (typeof activation === "number" && activation > 0) return "prerender";
  return entree?.type ?? "navigate";
}

/**
 * Pageview initiale + patch History API (SPA) : pushState/replaceState/popstate,
 * et retour depuis le cache avant/arrière du navigateur (bfcache).
 */
export function initNavigation(onPageview: (navType: string) => void): void {
  route = normalizeRoute(location.pathname);
  const navEntry = performance.getEntriesByType?.(
    "navigation",
  )[0] as PerformanceNavigationTiming | undefined;
  onPageview(typeNavigationInitiale(navEntry));

  // Une restauration bfcache ne réexécute pas le script ; seul `pageshow` (persisted)
  // la signale. Sans page vue ici, les web-vitals remis à zéro s'accrocheraient à la
  // trace précédente (finding 2.5).
  addEventListener("pageshow", (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    route = normalizeRoute(location.pathname);
    onPageview("bfcache");
  });

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
