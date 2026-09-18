// Analyses prêtes à l'emploi (P6.3) — logique PURE, testée, sans accès base.
//
// Un « découpage » répond à « comment cette mesure se répartit-elle selon une
// dimension ? » : onglets Route / Navigateur / Système / Pays / Appareil / Release
// au-dessus du graphe, chaque groupe cliquable vers la surface qui sait appliquer
// ce filtre. Trois règles tiennent tout le reste :
//
//   1. UN ONGLET NE MENT PAS. Une dimension que les mesures de l'écran ne savent
//      pas appliquer (sans objet, ou pas encore collectée) reste visible mais
//      DÉSACTIVÉE, avec sa raison — jamais un onglet qui rendrait un classement
//      calculé en ignorant la dimension demandée.
//   2. « INCONNU » N'EST PAS UNE VALEUR. Les lignes sans dimension forment un
//      groupe à part, dont le lien se compile en `is_null` et jamais en une
//      chaîne qui pourrait aussi être une vraie valeur déclarée.
//   3. LE DRILL-DOWN CONSERVE TOUT. Le lien d'un groupe reprend la plage et les
//      filtres courants, y ajoute la condition du groupe (ET, jamais un
//      remplacement), et vise une surface qui sait appliquer l'ensemble.
import {
  DIMENSION_LABELS,
  conditionsOf,
  hrefWithQuery,
  intersectQuery,
  type AnalyticsQuery,
  type Dimension,
} from "./query-contract";
import { GEO_NOTICE } from "./geo";
import { dimensionSupport, type DatasetId, type DimensionSchema } from "./query-compiler";
import { dimensionAvailability, surfaceFor } from "./surfaces";

/** Les six découpages proposés, dans l'ordre des onglets. */
export const BREAKDOWN_DIMENSIONS = ["route", "browser", "os", "country", "device", "release"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/** Paramètre d'URL portant l'onglet courant. */
export const BREAKDOWN_PARAM = "split";

/** Groupes rendus au plus ; au-delà, le tableau le dit. */
export const BREAKDOWN_CAP = 12;

/** Libellé du groupe sans valeur — jamais une valeur possible de la dimension. */
export const UNKNOWN_GROUP_LABEL = "Inconnu";

/** Onglet par défaut : la route, seule dimension collectée depuis toujours. */
export const BREAKDOWN_DEFAULT: BreakdownDimension = "route";

export const BREAKDOWN_LABELS: Record<BreakdownDimension, string> = {
  route: DIMENSION_LABELS.route,
  browser: DIMENSION_LABELS.browser,
  os: DIMENSION_LABELS.os,
  country: "Pays estimé",
  device: DIMENSION_LABELS.device,
  release: DIMENSION_LABELS.release,
};

/**
 * Ce que chaque dimension VAUT, dit à l'écran. Un découpage se lit mal sans
 * savoir d'où vient la valeur : un pays déduit du fuseau n'est pas une
 * géolocalisation, une release non renseignée n'est pas une release absente du
 * déploiement, et un navigateur déduit de l'user-agent reste une déduction.
 */
export const BREAKDOWN_NOTICES: Record<BreakdownDimension, string> = {
  route:
    "Route normalisée au moment de la mesure (jamais l'URL brute) : les identifiants reconnus y sont remplacés par un paramètre.",
  browser:
    "Famille déduite de l'user-agent déjà collecté, sans collecte supplémentaire ni empreinte : « Inconnu » couvre les user-agents non reconnus et les émetteurs sans navigateur.",
  os: "Système déduit de l'user-agent ou de la plateforme déclarée : « Inconnu » couvre les émetteurs sans terminal (erreur backend, robot).",
  country: GEO_NOTICE,
  device: "Classe de terminal déclarée par l'émetteur (desktop, mobile, tablette) : iOS et Android sont des systèmes, pas des classes.",
  release:
    "Release déclarée par l'émetteur SUR CHAQUE MESURE : une session qui change de version en cours de route compte dans les deux, et une mesure antérieure n'est jamais réécrite par une release posée plus tard.",
};

/** L'onglet demandé, s'il est proposé — sinon le premier onglet disponible. */
export function parseBreakdown(raw: string | null | undefined, available: readonly BreakdownDimension[]): BreakdownDimension | null {
  if (!available.length) return null;
  const asked = BREAKDOWN_DIMENSIONS.find((d) => d === raw);
  if (asked && available.includes(asked)) return asked;
  if (!asked && available.includes(BREAKDOWN_DEFAULT)) return BREAKDOWN_DEFAULT;
  return available[0];
}

export interface BreakdownTab {
  dimension: BreakdownDimension;
  label: string;
  /** L'écran sait-il appliquer cette dimension à TOUTES ses mesures ? */
  available: boolean;
  /** Pourquoi elle ne l'est pas (sans objet, pas encore collectée). */
  reason: string | null;
  current: boolean;
  /** Lien de l'onglet ; null quand il est désactivé. */
  href: string | null;
}

/**
 * Les onglets d'un écran, avec leur disponibilité réelle. `datasets` désigne les
 * mesures effectivement rendues sous les onglets (les vitals de l'accueil, les
 * erreurs de `/errors`) : c'est d'elles que dépend la disponibilité, pas de tout
 * ce que l'écran affiche par ailleurs.
 */
export function breakdownTabs(
  pathname: string,
  query: AnalyticsQuery,
  current: BreakdownDimension | null,
  availability: (dimension: BreakdownDimension) => { available: boolean; reason: string | null },
  /** Paramètres propres à l'écran à conserver d'un onglet à l'autre. */
  extra: Record<string, string | null | undefined> = {},
): BreakdownTab[] {
  return BREAKDOWN_DIMENSIONS.map((dimension) => {
    const state = availability(dimension);
    return {
      dimension,
      label: BREAKDOWN_LABELS[dimension],
      available: state.available,
      reason: state.reason,
      current: dimension === current,
      href: state.available ? hrefWithQuery(pathname, query, { ...extra, [BREAKDOWN_PARAM]: dimension }) : null,
    };
  });
}

/**
 * Disponibilité d'une dimension pour les mesures EFFECTIVEMENT découpées.
 *
 * Elle ne se confond pas avec la capacité de FILTRAGE de l'écran : l'accueil
 * compte aussi des sessions, qui ne portent pas de route, et n'accepte donc pas
 * `?route=` — mais ses Web Vitals, eux, se groupent parfaitement par route. Un
 * onglet est donc jugé sur le jeu de données qu'il groupe ; c'est la CIBLE du
 * lien de drill-down qui tient compte de ce que l'écran sait filtrer.
 */
export function datasetAvailability(datasets: readonly DatasetId[], schema: DimensionSchema) {
  return (dimension: BreakdownDimension) => {
    for (const dataset of datasets) {
      const support = dimensionSupport(dataset, dimension, schema);
      if (!support.supported) return { available: false, reason: support.message };
    }
    return { available: true, reason: null };
  };
}

/** Les dimensions réellement proposables, dans l'ordre des onglets. */
export function availableBreakdowns(
  availability: (dimension: BreakdownDimension) => { available: boolean },
): BreakdownDimension[] {
  return BREAKDOWN_DIMENSIONS.filter((dimension) => availability(dimension).available);
}

/**
 * Surface visée par le clic sur un groupe : l'écran courant s'il sait appliquer
 * la dimension, sinon `/pages`, la surface de détail des mesures par route.
 *
 * Cette vérification n'est pas cosmétique : l'accueil compte des SESSIONS, qui ne
 * portent ni route ni release. Y renvoyer `?route=/panier` produirait un refus de
 * filtre — un lien qui casse au lieu d'ouvrir le détail.
 */
export function breakdownTarget(pathname: string, dimension: BreakdownDimension, schema: DimensionSchema): string {
  const surface = surfaceFor(pathname);
  if (surface && dimensionAvailability(surface, dimension, schema).available) return pathname;
  return "/pages";
}

/**
 * Lien de drill-down d'un groupe : même plage, mêmes filtres, plus la condition
 * du groupe. Une dimension encore libre passe par son paramètre dédié (URL
 * lisible, relue à l'identique par le contrat) ; une dimension déjà contrainte
 * passe par un segment, donc par une INTERSECTION — un drill-down ne remplace
 * jamais un filtre global. Le groupe « Inconnu » se compile en `is_null`.
 */
export function breakdownDrillHref(
  pathname: string,
  query: AnalyticsQuery,
  dimension: BreakdownDimension,
  value: string | null,
  schema: DimensionSchema,
): string {
  const target = breakdownTarget(pathname, dimension, schema);
  const conditions: Dimension[] = conditionsOf(query.filters).map((c) => c.dimension);
  if (value === null) {
    return hrefWithQuery(target, intersectQuery(query, { conditions: [{ dimension, operator: "is_null", value: null }] }));
  }
  if (!conditions.includes(dimension)) return hrefWithQuery(target, query, { [dimension]: value });
  return hrefWithQuery(target, intersectQuery(query, { conditions: [{ dimension, operator: "eq", value }] }));
}

/** Libellé d'un groupe : sa valeur, ou « Inconnu » quand la dimension manque. */
export function groupLabel(value: string | null): string {
  return value ?? UNKNOWN_GROUP_LABEL;
}

/**
 * Alternative textuelle d'une ligne de découpage : ce qu'un lecteur d'écran
 * annonce à la place de la barre. Les barres sont décoratives partout ailleurs.
 */
export function groupDescription(dimension: BreakdownDimension, value: string | null, samples: number, unit: string): string {
  return `${BREAKDOWN_LABELS[dimension]} ${groupLabel(value)} — ${samples.toLocaleString("fr-FR")} ${unit}`;
}
