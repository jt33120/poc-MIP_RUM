import type { Pagination } from "./api/pagination";
import type { SearchParams } from "./filters";
import { hrefWithQuery, type AnalyticsQuery } from "./query-contract";

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

/** Un curseur est absolu : un offset résiduel ne doit jamais s'y ajouter. */
export function eventPagePagination(page: Pagination, cursor: unknown | null): Pagination {
  return cursor == null ? page : { ...page, offset: 0 };
}

/**
 * Retire les filtres propres aux événements (nom, attribut, curseur) sans perdre le
 * contexte global : app, plage, appareil, dimensions, segment, bots, apps internes.
 */
export function eventResetHref(query: AnalyticsQuery): string {
  return hrefWithQuery("/events", query);
}
