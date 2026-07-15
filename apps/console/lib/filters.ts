// Filtres globaux v0.3 (app / période / device) portés par les searchParams.
// Les intervalles SQL viennent EXCLUSIVEMENT de PERIODS (pas d'injection possible).
import { parseSegment, type SegCond } from "./segments";

export type PeriodKey = "1h" | "24h" | "7d";

export interface Filters {
  app: string | null; // null = toutes les apps
  period: PeriodKey;
  device: "desktop" | "mobile" | null; // null = tous
  segment: SegCond[]; // v1 : conditions arbitraires (dim<op>val) sur rum_session
  includeBots?: boolean; // Lot 2 : inclure le trafic non humain (défaut : exclu)
  includeInternal?: boolean; // v33 : inclure les apps internes (dogfooding) dans « Tous » (défaut : exclu)
}

export const PERIODS: Record<
  PeriodKey,
  { label: string; interval: string; bucket: string; bucketLabel: string }
> = {
  "1h": { label: "1 h", interval: "1 hour", bucket: "5 minutes", bucketLabel: "5 min" },
  "24h": { label: "24 h", interval: "24 hours", bucket: "1 hour", bucketLabel: "1 h" },
  "7d": { label: "7 j", interval: "7 days", bucket: "6 hours", bucketLabel: "6 h" },
};

export type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseFilters(sp: SearchParams, allowedApps?: string[] | null): Filters {
  const period = first(sp.period);
  const device = first(sp.device);
  const raw = first(sp.app);
  let app = raw && raw !== "all" ? raw : null;
  // RBAC v0.3 : liste blanche optionnelle (viewer scopé) — app hors scope ou
  // « toutes » -> fallback 1re app autorisée. Sans liste : comportement v0.2.
  if (allowedApps?.length && (!app || !allowedApps.includes(app))) app = allowedApps[0];
  return {
    app,
    period: period === "1h" || period === "7d" ? period : "24h",
    device: device === "desktop" || device === "mobile" ? device : null,
    segment: parseSegment(first(sp.seg)),
    includeBots: first(sp.bots) === "1",
    includeInternal: first(sp.internal) === "1",
  };
}
