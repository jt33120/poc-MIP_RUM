// Filtres globaux des pages — FAÇADE historique du contrat commun (lib/query-contract.ts).
//
// `Filters` garde sa forme v0.3 (app / période / device / segment) pour les écrans et
// les lectures qui ne connaissent que des presets ; la vérité des lectures migrées est
// `query`, résolu une fois par requête (périmètre signé, plage [from,to), filtres).
// Les intervalles SQL historiques viennent EXCLUSIVEMENT de PERIODS (pas d'injection).
import {
  RANGE_PRESETS,
  resolveRange,
  type AnalyticsQuery,
  type Device,
  type FilterCondition,
} from "./query-contract";
import type { SegCond } from "./segments";

export type PeriodKey = "1h" | "24h" | "7d";

export interface Filters {
  app: string | null; // null = toutes les apps du périmètre
  period: PeriodKey;
  device: "desktop" | "mobile" | null; // null = tous
  segment: SegCond[]; // v1 : conditions (dim<op>val) sur rum_session
  includeBots?: boolean; // Lot 2 : inclure le trafic non humain (défaut : exclu)
  includeInternal?: boolean; // v33 : inclure les apps internes (dogfooding) dans « Tous » (défaut : exclu)
  /** Contrat résolu (P6.2). Absent : appelant historique, reconstruit par `queryOf`. */
  query?: AnalyticsQuery;
}

export const PERIODS: Record<
  PeriodKey,
  { label: string; interval: string; bucket: string; bucketLabel: string }
> = {
  "1h": { label: "1 h", interval: "1 hour", bucket: "5 minutes", bucketLabel: "5 min" },
  "24h": { label: "24 h", interval: "24 hours", bucket: "1 hour", bucketLabel: "1 h" },
  "7d": { label: "7 j", interval: "7 days", bucket: "6 hours", bucketLabel: "6 h" },
};

// ══════════════════════ Découpage d'une période en seaux ══════════════════════
//
// DÉRIVÉ de PERIODS, jamais retapé : une sparkline codée en dur sur 24 seaux
// d'une heure continuait d'afficher 24 h quelle que soit la période choisie —
// un graphique qui montre une autre fenêtre que celle qu'il annonce.

const UNITES_MS: Record<string, number> = {
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
};

/** Convertit un intervalle PostgreSQL simple (« 6 hours ») en millisecondes. */
export function intervalleEnMs(intervalle: string): number {
  const m = /^(\d+)\s+([a-z]+)$/.exec(intervalle.trim());
  const unite = m ? UNITES_MS[m[2]] : undefined;
  // Jeter plutôt que rendre 0 : un intervalle non reconnu produirait des seaux
  // de largeur nulle, donc une division par zéro silencieuse dans les graphiques.
  if (!m || !unite) throw new Error(`intervalle non reconnu : ${intervalle}`);
  return Number(m[1]) * unite;
}

/** Largeur d'un seau, en secondes — l'unité que prend le SQL. */
export function seauEnSecondes(p: PeriodKey): number {
  return intervalleEnMs(PERIODS[p].bucket) / 1000;
}

/** Nombre de seaux couvrant la période : 1 h → 12, 24 h → 24, 7 j → 28. */
export function nombreDeSeaux(p: PeriodKey): number {
  return Math.round(intervalleEnMs(PERIODS[p].interval) / intervalleEnMs(PERIODS[p].bucket));
}

export type SearchParams = Record<string, string | string[] | undefined>;

const LEGACY_DIMENSION: Record<string, FilterCondition["dimension"]> = {
  geo: "country",
  device: "device",
  client: "client",
  source: "source",
};

const LEGACY_SEGMENT: Partial<Record<FilterCondition["dimension"], SegCond["dim"]>> = {
  country: "geo",
  device: "device",
  client: "client",
  source: "source",
};

/** Segment v1 équivalent (égalité/différence sur les dimensions historiques seulement). */
export function legacySegment(conditions: FilterCondition[]): SegCond[] {
  return conditions.flatMap((c) => {
    const dim = LEGACY_SEGMENT[c.dimension];
    if (!dim || c.operator === "is_null" || c.value === null) return [];
    return [{ dim, op: c.operator === "eq" ? "==" : "!=", value: c.value } as SegCond];
  });
}

/** Preset historique de même largeur de seau qu'une plage (lectures non migrées, libellés). */
export function periodOf(query: AnalyticsQuery): PeriodKey {
  if (query.range.preset) return query.range.preset;
  const seconds = query.range.bucketSeconds;
  return seconds <= 300 ? "1h" : seconds <= 3600 ? "24h" : "7d";
}

/**
 * Façade `Filters` d'une requête résolue : le contrat reste la vérité (`query`),
 * les champs historiques servent aux écrans et aux lectures à presets. La tablette
 * n'y a pas de place : les lectures P4/P5 la lisent dans `query`.
 */
export function filtersOfQuery(query: AnalyticsQuery): Filters {
  const device = query.filters.device;
  return {
    app: query.scope.requestedApp,
    period: periodOf(query),
    device: device === "desktop" || device === "mobile" ? device : null,
    segment: legacySegment(query.filters.segments),
    includeBots: query.filters.includeBots,
    includeInternal: query.filters.includeInternal,
    query,
  };
}

/** Filtres P4/P5 (tablette comprise) d'une requête résolue. */
export function deviceFiltersOfQuery(query: AnalyticsQuery): FiltersLike {
  return { ...filtersOfQuery(query), device: query.filters.device ?? null };
}

/** Filtres des lectures P4/P5 : le modèle historique plus la tablette. */
export type FiltersLike = Omit<Filters, "device"> & { device: Device | null };

/**
 * Contrat d'un `Filters` : `query` quand la requête a été résolue (page, API) ;
 * sinon (appelant historique, test), reconstruit depuis la façade — preset, app
 * nommée ou toutes les apps sans restriction, appareil, segment v1. Une lecture qui
 * resserre sur l'app d'une ressource passe par `resourceScope`, jamais par `app`.
 */
export function queryOf(f: FiltersLike, nowMs = Date.now()): AnalyticsQuery {
  if (f.query) return f.query;
  const period = (RANGE_PRESETS as readonly string[]).includes(f.period) ? f.period : "24h";
  const range = resolveRange({ period }, nowMs);
  if (!range.ok) throw new Error(range.error.message);
  return {
    version: 1,
    scope: { requestedApp: f.app, authorizedApps: null, effectiveApps: f.app ? [f.app] : null },
    range: range.value,
    filters: {
      ...(f.device ? { device: f.device } : {}),
      includeBots: f.includeBots === true,
      includeInternal: f.includeInternal === true,
      segments: f.segment.flatMap((c) => {
        const dimension = LEGACY_DIMENSION[c.dim];
        return dimension ? [{ dimension, operator: c.op === "==" ? "eq" : "neq", value: c.value } as FilterCondition] : [];
      }),
    },
  };
}
