// Parsing des filtres communs (app / period / device) pour l'API v1, à partir des
// query params. Produit LES DEUX formes de `Filters` du code existant — la couche
// data n'est pas dupliquée :
//   - `legacy` (lib/filters.ts) : app `string|null` (null = toutes), device `desktop|mobile|null`
//     -> queries.ts, queries-grid.ts, queries-tracing.ts, health.ts
//   - `v2` (lib/queries-v2.ts) : app `string` ('all'), device `string` ('all'|mobile|desktop|tablet)
//     -> queries-v2.ts (erreurs, corrélation, alerting)
// Le RBAC est appliqué ICI : un viewer scopé voit son app forcée (jamais « toutes »).
// Helper PUR : prend URLSearchParams + principal, aucun import next/*.
import type { Filters as LegacyFilters } from "../filters";
import type { Filters as V2Filters } from "../queries-v2";
import { parseSegment } from "../segments";
import type { ApiPrincipal } from "./auth";

const PERIOD_KEYS = ["1h", "24h", "7d"] as const;
type PeriodKey = (typeof PERIOD_KEYS)[number];

/** Clampe l'app demandée selon le scope du principal (admin/token = libre). */
function scopeApp(p: ApiPrincipal, requested: string | null): string | null {
  if (p.role === "admin" || !p.apps?.length) return requested;
  return requested && p.apps.includes(requested) ? requested : p.apps[0];
}

export interface ApiFilters {
  legacy: LegacyFilters;
  v2: V2Filters;
  app: string | null; // app effective après scoping (null = toutes)
  period: PeriodKey;
  device: string | null; // device demandé normalisé (null = tous), pour le meta
}

export function parseApiFilters(sp: URLSearchParams, principal: ApiPrincipal): ApiFilters {
  const rawApp = sp.get("app");
  const requested = rawApp && rawApp !== "all" ? rawApp : null;
  const app = scopeApp(principal, requested);

  const pr = (sp.get("period") ?? "24h").toLowerCase().replace("7j", "7d");
  const period: PeriodKey = (PERIOD_KEYS as readonly string[]).includes(pr)
    ? (pr as PeriodKey)
    : "24h";

  const dev = (sp.get("device") ?? "").toLowerCase();
  const legacyDevice = dev === "desktop" || dev === "mobile" ? dev : null;
  const v2Device = ["mobile", "desktop", "tablet"].includes(dev) ? dev : "all";

  return {
    legacy: { app, period, device: legacyDevice, segment: parseSegment(sp.get("seg")) },
    v2: { app: app ?? "all", period, device: v2Device },
    app,
    period,
    device: ["mobile", "desktop", "tablet"].includes(dev) ? dev : null,
  };
}
