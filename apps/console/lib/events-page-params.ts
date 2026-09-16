import type { Pagination } from "./api/pagination";
import type { Filters, SearchParams } from "./filters";
import type { EventFilters } from "./queries-events";

/**
 * Next représente les query params répétés par des tableaux. L'Explorer refuse
 * ces entrées ambiguës au lieu d'en choisir silencieusement une valeur.
 */
export function eventSearchParams(sp: SearchParams): URLSearchParams | null {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) return null;
    if (typeof value === "string") url.set(key, value);
  }
  return url;
}

/** Le modèle historique de filtres ne connaît pas tablette ; l'Explorer, si. */
export function eventPageFilters(filters: Filters, url: URLSearchParams | null): EventFilters {
  return {
    ...filters,
    device: url?.get("device") === "tablet" ? "tablet" : filters.device,
  };
}

/** Un curseur est absolu : un offset résiduel ne doit jamais s'y ajouter. */
export function eventPagePagination(page: Pagination, cursor: unknown | null): Pagination {
  return cursor == null ? page : { ...page, offset: 0 };
}

/** Retire les filtres propres aux événements sans perdre le contexte global. */
export function eventResetHref(filters: EventFilters): string {
  const qs = new URLSearchParams({ period: filters.period });
  if (filters.app) qs.set("app", filters.app);
  if (filters.device) qs.set("device", filters.device);
  return `/events?${qs}`;
}
