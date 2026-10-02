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
 * Type de la navigation initiale. Une page PRÉRENDUE puis affichée porte un
 * `activationStart` positif : on la dit `prerender`, comme web-vitals le fait pour
 * ses mesures (`webvital.navigation_type`) — ses temps de chargement se comptent
 * depuis l'affichage, pas depuis la requête. Le prérendu jamais affiché, lui,
 * n'émet rien du tout (index.ts diffère la collecte jusqu'à l'activation).
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

  // RESTAURATION DEPUIS LE BFCACHE (finding 2.5). La page revient telle qu'on l'a
  // quittée, sans rechargement : le script ne se réexécute pas, et rien d'autre
  // que `pageshow` (persisted) ne le dit. Sans page vue ici, les mesures que
  // web-vitals rapporte après la restauration (LCP, CLS, INP remis à zéro)
  // s'accrochaient à la trace de la visite précédente, et un retour arrière ne
  // comptait pas comme une page vue. C'en est une : l'utilisateur voit la page.
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
