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
   * Lecture historique, pas encore migrée vers le contrat : presets seulement, et
   * seules l'app et la période s'appliquent. (La variante `segments` — desktop,
   * mobile et segment v1 — a disparu avec F53 : les écrans d'usage qui la
   * portaient lisent sur le contrat depuis B31.)
   */
  legacy?: "period-only";
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
}

// Plus de drapeau « lecture mono-app » (F40, R-A) : `/acquisition`, `/paths`,
// `/forms` et `/retention` filtraient l'app par « app demandée, ou toutes si elle
// est nulle », et un principal restreint qui demandait toutes ses apps était refusé
// (« Cet écran lit une application à la fois »). Leurs lectures passent par
// `sqlContext` depuis B31 (apps EFFECTIVES liées) : le refus provisoire est levé
// (F53), comme F66 l'avait fait pour `/goals`.

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
  // B31 → F53 : /paths, /forms et /acquisition lisent sur le contrat (`sqlContext`,
  // apps effectives liées), comme /goals depuis F66 — plus de `legacy` ni de refus
  // « une application à la fois » ; plage personnalisée, tablette et « Inconnu »
  // s'appliquent. Jeu `sessions` : leurs chiffres comptent des sessions (ou des
  // tentatives de formulaire rapportées à elles) ; une dimension d'occurrence
  // (route, release, env) ne filtrerait qu'une partie des vues ou des événements
  // d'une session, elle reste refusée avec sa raison.
  { path: "/paths", datasets: ["sessions"], range: "custom" },
  { path: "/forms", datasets: ["sessions"], range: "custom" },
  // F66 : /goals lit sur le contrat (`sqlContext`, apps effectives liées) — plus de
  // `legacy` ni de refus « une application à la fois » ; plage personnalisée,
  // tablette et « Inconnu » s'appliquent. Jeu `sessions` : les taux portent sur une
  // cohorte de sessions ; une dimension d'occurrence (route, release) filtrerait le
  // numérateur sans le dénominateur, elle reste refusée avec sa raison.
  { path: "/goals", datasets: ["sessions"], range: "custom" },
  { path: "/acquisition", datasets: ["sessions"], range: "custom" },
  // La rétention lit N SEMAINES, choisies dans l'écran (`?weeks=`), jamais la
  // période du haut : lib/queries-cohorts.ts ne lit pas la plage du contrat.
  // Proposer 1 h / 24 h / 7 j laisserait croire qu'ils s'appliquent (§ 5.17.5).
  // Périmètre et filtres, eux, passent par `sqlContext` depuis B31 : plus de
  // `legacy` ni de refus « une application à la fois » (F53).
  {
    path: "/retention",
    datasets: ["sessions"],
    range: "none",
    rangeNote: "La rétention se lit sur un nombre de semaines choisi dans l'écran ; la période choisie en haut ne s'applique pas.",
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
  // Une lecture historique (`legacy`) refuse déjà toute dimension : la tablette et
  // « Inconnu » n'ont plus besoin d'une règle à part.
  return dimensionAvailability(surface, condition.dimension, schema);
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
 * personnalisée sur un écran à presets, filtre sur une lecture historique,
 * dimension absente d'une mesure : refus typé, jamais un oubli.
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
