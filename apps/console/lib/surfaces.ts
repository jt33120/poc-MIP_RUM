// Capacités de filtrage des écrans (P6.2) — logique PURE, partagée par le serveur
// (validation d'une URL) et la barre de filtres (contrôles désactivés avec raison).
//
// RÈGLE : un filtre n'est proposé sur un écran que si TOUTES les mesures qu'il
// affiche savent l'appliquer. Sinon il est désactivé avec sa raison, et une URL qui
// l'impose est refusée avec une erreur récupérable — jamais un navigateur
// sélectionné au-dessus d'un chiffre qui l'ignore.
import { dimensionSupport, type DatasetId, type DimensionSchema } from "./query-compiler";
import {
  DIMENSION_LABELS,
  conditionsOf,
  type AnalyticsQuery,
  type ContractError,
  type Dimension,
  type FilterCondition,
  type Parsed,
} from "./query-contract";

export type RangeCapability = "custom" | "presets" | "none";

export interface Surface {
  /** Route exacte, ou préfixe terminé par `/`. */
  path: string;
  datasets: DatasetId[];
  range: RangeCapability;
  /** Pourquoi la plage ne s'applique pas ou reste limitée aux presets. */
  rangeNote?: string;
  /**
   * Lecture historique, pas encore migrée vers le contrat : presets seulement ;
   * `segments` applique aussi desktop/mobile et le segment v1 (pays, appareil, client,
   * source en égalité ou différence) ; `period-only` n'applique que l'app et la période.
   */
  legacy?: "segments" | "period-only";
  /** Écran sans mesure filtrable : seuls l'app et, s'il y a lieu, la plage comptent. */
  noFilters?: string;
}

const LEGACY_DIMENSIONS: readonly Dimension[] = ["device", "country", "client", "source"];

// Du plus spécifique au plus général : le premier préfixe qui correspond gagne.
export const SURFACES: Surface[] = [
  // L'Explorer ne fixe PAS son jeu de données : c'est l'utilisateur qui le choisit.
  // Déclarer une liste ici reviendrait à n'autoriser que les dimensions communes à
  // TOUS les jeux — `service` disparaîtrait alors même des erreurs. Il n'ignore pour
  // autant aucun filtre : la requête est validée contre le jeu RÉELLEMENT choisi et
  // refuse avec `unsupported_dimension` ce qu'il ne porte pas (lib/analytics-schema.ts).
  { path: "/explorer", datasets: [], range: "custom" },
  { path: "/errors/", datasets: ["errors"], range: "custom" },
  { path: "/errors", datasets: ["errors"], range: "custom" },
  { path: "/events", datasets: ["events"], range: "custom" },
  { path: "/actions", datasets: ["actions"], range: "custom" },
  { path: "/ux", datasets: ["custom_events", "vitals", "longtasks"], range: "custom" },
  { path: "/pages", datasets: ["views", "vitals", "longtasks", "resources"], range: "custom" },
  {
    path: "/sessions/",
    datasets: [],
    range: "none",
    noFilters: "Une session s'affiche en entier : les filtres de population ne s'y appliquent pas.",
  },
  { path: "/sessions", datasets: ["sessions", "views"], range: "custom" },
  { path: "/correlation", datasets: ["vitals", "synthetic"], range: "custom" },
  { path: "/map", datasets: ["spans", "vitals"], range: "custom" },
  { path: "/experience", datasets: ["custom_events", "vitals", "sessions"], range: "custom" },
  { path: "/tracing/", datasets: [], range: "none", noFilters: "Une trace s'affiche en entier." },
  { path: "/tracing", datasets: ["spans"], range: "custom" },
  {
    path: "/slo",
    datasets: [],
    range: "none",
    rangeNote: "Chaque SLO se mesure sur sa propre fenêtre glissante.",
    noFilters: "Les SLO portent leur propre métrique, route et fenêtre : seule l'app sélectionnée filtre la liste.",
  },
  {
    path: "/alerts",
    datasets: [],
    range: "none",
    rangeNote: "Chaque règle s'évalue sur sa propre fenêtre.",
    noFilters:
      "Une règle s'évalue sur sa métrique, sa route et son env : les filtres de population ne s'appliquent ni aux règles ni à leurs déclenchements.",
  },
  {
    path: "/dashboards/",
    datasets: ["vitals", "views", "longtasks", "errors", "custom_events", "events"],
    range: "custom",
    rangeNote: "Le widget « Trafic » garde sa fenêtre fixe de 14 jours.",
  },
  {
    path: "/dashboards",
    datasets: [],
    range: "none",
    noFilters: "La liste des tableaux de bord ne dépend que de l'app sélectionnée.",
  },
  { path: "/paths", datasets: ["sessions"], range: "presets", legacy: "segments" },
  { path: "/forms", datasets: ["sessions"], range: "presets", legacy: "segments" },
  { path: "/goals", datasets: ["sessions"], range: "presets", legacy: "segments" },
  { path: "/acquisition", datasets: ["sessions"], range: "presets", legacy: "segments" },
  { path: "/retention", datasets: ["sessions"], range: "presets", legacy: "segments" },
  { path: "/logs", datasets: [], range: "presets", legacy: "period-only" },
  { path: "/ai", datasets: [], range: "presets", legacy: "period-only" },
  { path: "/forecast", datasets: [], range: "presets", legacy: "period-only" },
  { path: "/svi/", datasets: [], range: "presets", legacy: "period-only" },
  { path: "/svi", datasets: [], range: "presets", legacy: "period-only" },
  {
    path: "/",
    datasets: ["vitals", "views", "errors", "sessions"],
    range: "custom",
    rangeNote: "L'historique de santé (14 j) et les anomalies (24 h) gardent leur fenêtre fixe.",
  },
];

/** Surface d'un chemin, ou null (écran sans filtres globaux : admin, sélection…). */
export function surfaceFor(pathname: string): Surface | null {
  for (const surface of SURFACES) {
    if (surface.path === "/") {
      if (pathname === "/") return surface;
      continue;
    }
    if (surface.path.endsWith("/") ? pathname.startsWith(surface.path) : pathname === surface.path) return surface;
  }
  return null;
}

export type FilterAvailability = { available: true } | { available: false; reason: string };

/** Une dimension est-elle applicable à TOUTES les mesures de l'écran ? */
export function dimensionAvailability(surface: Surface, dimension: Dimension, schema: DimensionSchema): FilterAvailability {
  if (surface.noFilters) return { available: false, reason: surface.noFilters };
  if (surface.legacy) {
    if (surface.legacy === "segments" && LEGACY_DIMENSIONS.includes(dimension)) return { available: true };
    return {
      available: false,
      reason: `« ${DIMENSION_LABELS[dimension]} » n'est pas encore appliqué par cet écran`,
    };
  }
  for (const dataset of surface.datasets) {
    const support = dimensionSupport(dataset, dimension, schema);
    if (!support.supported) return { available: false, reason: support.message };
  }
  return { available: true };
}

/** Une condition complète (dimension, opérateur, valeur) est-elle applicable à l'écran ? */
export function conditionAvailability(surface: Surface, condition: FilterCondition, schema: DimensionSchema): FilterAvailability {
  const availability = dimensionAvailability(surface, condition.dimension, schema);
  if (!availability.available) return availability;
  if (surface.legacy && (condition.operator === "is_null" || condition.value === "tablet")) {
    return { available: false, reason: "Cet écran n'applique ni « Inconnu » ni la tablette." };
  }
  return { available: true };
}

export function rangeAvailability(surface: Surface, custom: boolean): FilterAvailability {
  if (surface.range === "none") {
    return { available: false, reason: surface.rangeNote ?? surface.noFilters ?? "La plage ne s'applique pas à cet écran." };
  }
  if (custom && surface.range === "presets") {
    return { available: false, reason: "Cet écran n'accepte encore que les périodes 1 h, 24 h et 7 j." };
  }
  return { available: true };
}

const unsupported = (message: string, extra: Partial<ContractError> = {}): Parsed<never> => ({
  ok: false,
  error: { code: "unsupported_dimension", message, ...extra },
});

/**
 * Une requête résolue est-elle entièrement applicable à l'écran ? Plage
 * personnalisée sur un écran à presets, tablette ou `is_null` sur une lecture
 * historique, dimension absente d'une mesure : refus typé, jamais un oubli.
 */
export function checkSurface(query: AnalyticsQuery, surface: Surface, schema: DimensionSchema): Parsed<true> {
  if (query.range.preset === null) {
    const range = rangeAvailability(surface, true);
    if (!range.available) return unsupported(range.reason, { parameter: "from" });
  }
  for (const condition of conditionsOf(query.filters)) {
    const availability = conditionAvailability(surface, condition, schema);
    if (!availability.available) return unsupported(availability.reason, { dimension: condition.dimension });
  }
  return { ok: true, value: true };
}
