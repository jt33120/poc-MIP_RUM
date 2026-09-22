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
  type QueryScope,
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
  /**
   * Liste BLANCHE de dimensions, quand l'écran en applique moins que ses jeux de
   * données ne pourraient. Utile lorsqu'une mesure est un TAUX sur une cohorte :
   * une dimension d'occurrence (route, service) filtrerait le numérateur sans le
   * dénominateur, et le résultat ne serait plus un taux. Une dimension absente de
   * la liste est refusée avec sa raison, jamais appliquée à moitié.
   */
  only?: readonly Dimension[];
  /** Écran sans mesure filtrable : seuls l'app et, s'il y a lieu, la plage comptent. */
  noFilters?: string;
  /**
   * Lecture qui ne sait filtrer qu'UNE app, par la clause `($1::text is null or
   * app_id = $1)` : sous `app=all`, `$1` vaut null et la clause laisse passer TOUTES
   * les apps de la base, qu'elles soient ou non dans le périmètre du principal
   * (R-A, CS1). Tant que ces lectures ne passent pas par `sqlContext` (B31 → F53 ;
   * F66 pour `/goals`), un principal RESTREINT qui demande toutes ses apps est
   * refusé (`perimetreAvailability`) : un refus dit, plutôt qu'une lecture hors
   * périmètre.
   */
  appUnique?: true;
}

// `country_source` (P8.7) accompagne `country` : les écrans qui savent segmenter sur
// un pays savent segmenter sur sa provenance, puisque c'est la même jointure de
// session et le même compilateur. Les séparer aurait rendu un pays filtrable
// sans que son origine le soit — exactement le mélange que ce lot corrige.
const LEGACY_DIMENSIONS: readonly Dimension[] = ["device", "country", "country_source", "client", "source"];

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
  // `/mobile` mesure une COHORTE de sessions React Native, et en tire des taux.
  // Les jeux de données sont ceux qu'il lit ; `only` dit ce qu'il applique. Une
  // route ou un service filtreraient les occurrences sans filtrer les sessions :
  // le taux de sessions sans erreur JS n'aurait plus le même dénominateur que
  // son numérateur. `sessions` est volontairement absent des jeux : la release
  // d'un binaire mobile est stable pour toute la session et se compile sur elle
  // (cf. lib/queries-mobile.ts), là où le contrat la range en dimension
  // d'occurrence pour le web.
  {
    path: "/mobile",
    datasets: ["views", "errors", "custom_events", "spans"],
    range: "custom",
    only: ["device", "os", "release"],
  },
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
  { path: "/paths", datasets: ["sessions"], range: "presets", legacy: "segments", appUnique: true },
  { path: "/forms", datasets: ["sessions"], range: "presets", legacy: "segments", appUnique: true },
  { path: "/goals", datasets: ["sessions"], range: "presets", legacy: "segments", appUnique: true },
  { path: "/acquisition", datasets: ["sessions"], range: "presets", legacy: "segments", appUnique: true },
  // La rétention lit N SEMAINES, choisies dans l'écran (`?weeks=`), jamais la
  // période du haut : lib/queries-cohorts.ts ne lit ni `f.period` ni PERIODS.
  // Proposer 1 h / 24 h / 7 j laisserait croire qu'ils s'appliquent (§ 5.17.5).
  {
    path: "/retention",
    datasets: ["sessions"],
    range: "none",
    rangeNote: "La rétention se lit sur un nombre de semaines choisi dans l'écran ; la période choisie en haut ne s'applique pas.",
    legacy: "segments",
    appUnique: true,
  },
  { path: "/logs", datasets: [], range: "presets", legacy: "period-only" },
  { path: "/ai", datasets: [], range: "presets", legacy: "period-only" },
  // La projection lit toujours les 14 derniers jours complets (lib/queries-grid.ts,
  // `time: null`) : proposer 1 h / 24 h / 7 j laisserait croire qu'ils s'appliquent.
  {
    path: "/forecast",
    datasets: [],
    range: "none",
    rangeNote: "Cet écran lit une fenêtre fixe de 14 jours complets ; la période choisie en haut ne s'applique pas.",
    legacy: "period-only",
  },
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

/**
 * Routes à lecture EXPLICITE, que `AutoRefresh` ne relit pas toutes les 5 s (§ 3.11,
 * CE10). Un Explorer exécuté (`run=1`) relançait sa requête et un tableau de bord
 * relisait ses cartes au-delà de leur cache : le résultat changeait sous le curseur,
 * et la promesse « exécution explicite » n'était tenue qu'au premier rendu. Ces
 * écrans affichent l'heure de lecture et un bouton « Relire ».
 * `exacts` : égalité stricte ; `prefixes` : tout chemin qui commence ainsi.
 */
export const SANS_RAFRAICHISSEMENT = {
  exacts: ["/explorer", "/explorer/views", "/dashboards"],
  prefixes: ["/dashboards/"],
} as const satisfies { exacts: readonly string[]; prefixes: readonly string[] };

/** Ce chemin est-il lu à la demande (pas de rafraîchissement automatique) ? */
export function sansRafraichissement(pathname: string): boolean {
  return (
    (SANS_RAFRAICHISSEMENT.exacts as readonly string[]).includes(pathname) ||
    SANS_RAFRAICHISSEMENT.prefixes.some((p) => pathname.startsWith(p))
  );
}

export type FilterAvailability ={ available: true } | { available: false; reason: string };

/** Une dimension est-elle applicable à TOUTES les mesures de l'écran ? */
export function dimensionAvailability(surface: Surface, dimension: Dimension, schema: DimensionSchema): FilterAvailability {
  if (surface.noFilters) return { available: false, reason: surface.noFilters };
  if (surface.only && !surface.only.includes(dimension)) {
    return {
      available: false,
      reason: `« ${DIMENSION_LABELS[dimension]} » n'est pas applicable à cet écran : ses mesures portent sur une cohorte de sessions, pas sur des occurrences`,
    };
  }
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

/** Refus provisoire des écrans à lecture mono-app (F40, R-A) : texte opposable. */
export const RAISON_APP_UNIQUE =
  "Cet écran lit une application à la fois : choisissez l'une des applications de votre périmètre.";

/**
 * Le périmètre demandé est-il lisible par l'écran ? Refus quand l'écran ne sait
 * filtrer qu'une app (`appUnique`), que l'URL les demande toutes
 * (`requestedApp === null`) ET que le principal est restreint
 * (`authorizedApps !== null`) : la lecture sortirait de son périmètre. Un
 * principal sans restriction (admin, viewer sans liste) lit de droit toutes les
 * apps : rien à refuser.
 *
 * Défense en profondeur : la porte « projet courant » du middleware réécrit déjà
 * `app=all` en l'app du projet pour un principal restreint (middleware.ts). Ce
 * refus tient même si cette porte change ; il se lève avec la migration des
 * lectures sur `sqlContext` (F53, F66).
 */
export function perimetreAvailability(surface: Surface, scope: QueryScope): FilterAvailability {
  if (surface.appUnique && scope.requestedApp === null && scope.authorizedApps !== null) {
    return { available: false, reason: RAISON_APP_UNIQUE };
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
