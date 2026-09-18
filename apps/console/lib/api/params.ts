// Filtres communs de l'API v1, résolus par le contrat unique (lib/query-contract.ts).
// Produit la requête résolue et, pour les lectures qui ne connaissent que les presets,
// les deux façades historiques — la couche data n'est pas dupliquée :
//   - `legacy` (lib/filters.ts) : app `string|null`, device `desktop|mobile|null`, `query` inclus ;
//   - `v2` (lib/queries-v2.ts) : app `string` ('all'), device `string`.
// Le PÉRIMÈTRE est résolu ICI, contre le principal signé : une liste d'apps vide
// n'ouvre rien (403), une app hors périmètre est refusée (403) au lieu d'être
// rabattue sur la première app autorisée, et « toutes » vaut toutes les apps
// AUTORISÉES. Helper PUR : prend URLSearchParams + principal, aucun import next/*.
import { filtersOfQuery, type Filters as LegacyFilters, type PeriodKey } from "../filters";
import type { Filters as V2Filters } from "../queries-v2";
import { parseAnalyticsQuery, resourceScope, type AnalyticsQuery, type Parsed } from "../query-contract";
import type { ApiPrincipal } from "./auth";

export interface ApiFilters {
  query: AnalyticsQuery;
  legacy: LegacyFilters;
  v2: V2Filters;
  app: string | null; // app demandée (null = toutes les apps autorisées)
  period: PeriodKey | "custom";
  device: string | null; // appareil demandé (null = tous), pour le meta
}

/**
 * Ressource dont l'identifiant fait foi (groupe d'erreurs, issue) : `meta.app`,
 * `meta.scope` et l'ETag annoncent l'app dont viennent RÉELLEMENT les chiffres.
 * `app` doit appartenir au périmètre autorisé — la lecture l'a résolue dedans.
 */
export function announceResourceApp(filters: ApiFilters, app: string): void {
  filters.app = app;
  filters.query = resourceScope(filters.query, app);
}

export function parseApiFilters(
  sp: URLSearchParams,
  principal: Pick<ApiPrincipal, "role" | "apps">,
  nowMs = Date.now(),
): Parsed<ApiFilters> {
  const parsed = parseAnalyticsQuery(sp, { principal, nowMs });
  if (!parsed.ok) return parsed;
  const query = parsed.value;
  const legacy = filtersOfQuery(query);
  const device = query.filters.device ?? null;
  return {
    ok: true,
    value: {
      query,
      legacy,
      v2: { app: query.scope.requestedApp ?? "all", period: legacy.period, device: device ?? "all" },
      app: query.scope.requestedApp,
      period: query.range.preset ?? "custom",
      device,
    },
  };
}
