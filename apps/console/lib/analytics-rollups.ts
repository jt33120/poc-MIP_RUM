// Registre des agrégats pré-calculés et règle d'emploi (P6.6) — logique PURE,
// testée, sans accès base.
//
// ─────────────────────────── LA RÈGLE, EN UNE PHRASE ─────────────────────────
//
// Un agrégat ne répond à une requête QUE s'il porte, lui-même, TOUTES les
// dimensions demandées — celles du regroupement ET celles des filtres — et que sa
// population est exactement celle qu'on mesure. Un agrégat sans colonne
// navigateur ne répondra JAMAIS à `browser = Firefox` : ni en l'ignorant, ni en
// l'approchant. La vérification est déclarative (ci-dessous), pas une suite de
// `if` dispersés dans le SQL.
//
// ─────────────────── POURQUOI SI PEU D'AGRÉGATS SONT ÉLIGIBLES ───────────────
//
// `rum_rollup_hourly` (v12/v64) agrège les vues et les occurrences d'erreurs par
// (app, appareil, heure). DEUX faits, déclarés ci-dessous, l'écartent :
//
//   · son rafraîchissement ne filtre pas `is_bot` : sa population inclut les
//     robots, que l'Explorer exclut par défaut. Aucune arithmétique ne rapproche
//     deux populations différentes ;
//   · il ne tient AUCUN filigrane de rafraîchissement — ni instant, ni
//     identifiant. Sans lui, rien ne dit quelles heures sont consolidées ni où
//     reprendre les lignes brutes : la partition ne peut pas être PROUVÉE, et
//     une hybridation « à peu près disjointe » double-compte ou perd des lignes.
//     Lui en donner un relève du lot qui en aura l'usage.
//
// Il reste déclaré : le registre doit dire ce qui existe et pourquoi on ne s'en
// sert pas. Mieux vaut un agrégat inutilisé qu'un total faux.
//
// `metric_histogram_hourly` (v61), lui, EXCLUT les robots, porte l'appareil et le
// nom de la métrique, et stocke une distribution en seaux : fusionnable, donc un
// percentile s'y lit exactement comme sur les lignes brutes — à la largeur de
// seau près, annoncée. v80 lui ajoute `observed_count`, le nombre de mesures
// REÇUES, parce que `weighted_count` compte des poids d'échantillonnage : ce
// n'est pas le dénominateur « observed » de l'Explorer.
//
// ────────────────────── CE QU'UN AGRÉGAT NE SAURA JAMAIS FAIRE ───────────────
//
// Un dénombrement de valeurs DISTINCTES n'est pas additif : la somme des sessions
// distinctes de chaque heure compte deux fois une session qui traverse minuit.
// Aucune structure de ce dépôt ne rend ce calcul fusionnable (ni HLL, ni
// t-digest) : `distinct` est donc refusé par construction, pas par oubli.
import { percentileDepuisSeaux, type SeauPondere } from "./histogramme";
import type { Aggregation, ExplorerDatasetId, ExplorerPlan, Visualization } from "./analytics-schema";
import type { AnalyticsQuery, Dimension, ResolvedRange } from "./query-contract";

/** Grain de tous les agrégats horaires du dépôt. */
export const GRAIN_SECONDS = 3600;
const GRAIN_MS = GRAIN_SECONDS * 1000;

export type RollupShape = "histogram" | "additive";

/** Un couple (jeu, mesure, agrégation) qu'un agrégat sait rendre. */
export interface RollupAnswer {
  dataset: ExplorerDatasetId;
  field: string;
  aggregations: readonly Aggregation[];
  /** Représentations servies. Hors de cette liste, la lecture repasse au brut. */
  visualizations: readonly Visualization[];
  /** L'agrégat est indexé par la sous-population : elle doit être choisie. */
  requiresVariant: boolean;
  /** Sous-populations réellement couvertes par le rafraîchissement. */
  variants?: readonly string[];
}

export interface RollupSource {
  /**
   * Identifiant PUBLIC de la source, publié par le registre de capacités et par
   * `meta.rollup.source`. Il ne nomme pas la table : le registre public ne révèle
   * aucun schéma SQL, et le nom d'une table n'apprend rien à un builder d'UI.
   */
  id: string;
  label: string;
  /** Table de l'agrégat. Identifiant de code, jamais dérivé d'une entrée. */
  table: string;
  /** Colonne d'heure de l'agrégat. */
  hour: string;
  /**
   * Filigrane du dernier rafraîchissement : l'instant jusqu'où l'agrégat est
   * consolidé, et l'identifiant au-dessus duquel une ligne n'y est pas encore.
   * `null` : aucun filigrane, donc aucune partition démontrable — la source est
   * déclarée mais jamais lue.
   */
  state: { table: string; refreshedAt: string; maxId: string } | null;
  grainSeconds: number;
  /** Dimensions RÉELLEMENT portées par une ligne d'agrégat. Rien d'autre. */
  dimensions: readonly Dimension[];
  /** Colonne portant chaque dimension, dans l'agrégat. */
  columns: Partial<Record<Dimension, string>>;
  /** Le rafraîchissement a-t-il gardé les robots ? */
  includesBots: boolean;
  shape: RollupShape;
  /** Un percentile lu sur des seaux est approché : la largeur de seau le borne. */
  approximate: boolean;
  answers: readonly RollupAnswer[];
  /** Ce que l'agrégat ne dit pas, annoncé dans `meta.warnings`. */
  notice: string | null;
}

export const ROLLUP_SOURCES = {
  vitals_histogram: {
    id: "vitals_histogram",
    label: "Distribution horaire des Web Vitals",
    table: "metric_histogram_hourly",
    hour: "hour",
    state: { table: "metric_histogram_state", refreshedAt: "refreshed_at", maxId: "max_metric_id" },
    grainSeconds: GRAIN_SECONDS,
    // L'agrégat porte l'appareil, et RIEN d'autre : pas de route, pas de release,
    // pas de navigateur. Une requête qui en demande une repasse sur le brut.
    dimensions: ["device"],
    columns: { device: "device_type" },
    includesBots: false,
    shape: "histogram",
    approximate: true,
    answers: [
      {
        dataset: "vitals",
        field: "value",
        // Ni `avg` : une moyenne lue sur des seaux n'est pas la moyenne des
        // valeurs, et rien n'oblige à l'approcher quand le brut la donne juste.
        aggregations: ["p75", "p95"],
        // Le total et le classement, pas la série : un percentile par seau
        // temporel multiplierait les distributions à fusionner par le nombre de
        // seaux, pour un gain que la mesure ne montre pas. La série reste brute,
        // et `meta.source` le dit.
        visualizations: ["value", "toplist"],
        requiresVariant: true,
        variants: ["LCP", "INP", "CLS", "FCP", "TTFB"],
      },
    ],
    notice:
      "Percentile lu sur une distribution en seaux de 2 % : la valeur rendue est approchée à environ " +
      "1 % près, jamais arrondie en silence.",
  },

  traffic_hourly: {
    id: "traffic_hourly",
    label: "Trafic horaire (vues et occurrences d'erreurs)",
    table: "rum_rollup_hourly",
    hour: "hour",
    // Aucun filigrane : `refresh_rum_rollups` n'en enregistre pas.
    state: null,
    grainSeconds: GRAIN_SECONDS,
    dimensions: ["device"],
    columns: { device: "device_type" },
    // Son rafraîchissement ne filtre pas `is_bot` : la population inclut les
    // robots. Déclaré ici, ce fait suffit à interdire l'agrégat partout où la
    // requête les exclut — c'est-à-dire par défaut.
    includesBots: true,
    shape: "additive",
    approximate: false,
    answers: [
      {
        dataset: "views",
        field: "rows",
        aggregations: ["count"],
        visualizations: ["value", "toplist", "timeseries"],
        requiresVariant: false,
      },
      {
        dataset: "errors",
        field: "occurrences",
        aggregations: ["sum"],
        visualizations: ["value", "toplist", "timeseries"],
        requiresVariant: false,
      },
    ],
    notice: null,
  },
} as const satisfies Record<string, RollupSource>;

export type RollupId = keyof typeof ROLLUP_SOURCES;
export const ROLLUP_IDS = Object.keys(ROLLUP_SOURCES) as RollupId[];

export function rollupSource(id: RollupId): RollupSource {
  return ROLLUP_SOURCES[id] as RollupSource;
}

// ───────────────────── La vérification de capacité ───────────────────────────

export type RollupDecision =
  | { usable: true; source: RollupSource; answer: RollupAnswer }
  | { usable: false; reason: string };

const refus = (reason: string): RollupDecision => ({ usable: false, reason });

/**
 * L'agrégat `source` peut-il répondre à `plan` sous `query` ? Les contrôles
 * s'enchaînent du plus structurel au plus circonstanciel, et chacun rend SA
 * raison — celle qui sera affichée et journalisée, jamais un « non » muet.
 */
export function rollupAnswers(source: RollupSource, plan: ExplorerPlan, query: AnalyticsQuery): RollupDecision {
  const answer = source.answers.find((a) => a.dataset === plan.dataset && a.field === plan.measure.field);
  if (!answer) {
    return refus(`${source.label} ne porte pas cette mesure`);
  }
  if (!answer.aggregations.includes(plan.measure.aggregation)) {
    return refus(`${source.label} ne porte pas cette agrégation`);
  }
  // Un distinct n'est jamais additif : la somme des distincts horaires compte
  // deux fois une session qui traverse une heure. Aucun agrégat de ce dépôt ne
  // porte de structure fusionnable pour les cardinalités.
  if (plan.measure.aggregation === "distinct") {
    return refus("un dénombrement de valeurs distinctes ne s'additionne pas d'une heure à l'autre");
  }
  if (query.filters.includeBots !== source.includesBots) {
    return refus(
      source.includesBots
        ? `${source.label} inclut les robots, que cette mesure exclut`
        : `${source.label} exclut les robots, que cette mesure inclut`,
    );
  }
  // Sans filigrane, impossible de dire où finit le consolidé et où reprend le
  // brut : la partition ne serait pas démontrable, seulement plausible.
  if (!source.state) {
    return refus(`${source.label} ne tient pas de filigrane de rafraîchissement : la partition ne serait pas démontrable`);
  }
  if (answer.requiresVariant && plan.variant === null) {
    return refus(`${source.label} est indexé par sous-population : elle doit être choisie`);
  }
  if (plan.variant !== null && answer.variants && !answer.variants.includes(plan.variant)) {
    return refus(`${source.label} ne couvre pas « ${plan.variant} »`);
  }
  // LE contrôle central : toute dimension demandée — regroupement ou filtre —
  // doit exister DANS l'agrégat. Sinon il ne peut pas la distinguer, et
  // l'appliquer après coup reviendrait à filtrer un total déjà mélangé.
  for (const dimension of plan.groupBy) {
    if (!source.dimensions.includes(dimension)) {
      return refus(`${source.label} ne porte pas la dimension « ${dimension} » demandée en regroupement`);
    }
  }
  for (const condition of query.filters.segments) {
    if (!source.dimensions.includes(condition.dimension)) {
      return refus(`${source.label} ne porte pas la dimension « ${condition.dimension} » demandée en filtre`);
    }
  }
  // Le journal paginé rend des LIGNES : un agrégat n'en a aucune à montrer.
  if (!answer.visualizations.includes(plan.visualization)) {
    return refus(
      plan.visualization === "table"
        ? `${source.label} n'a pas de lignes à paginer`
        : `${source.label} ne sert pas cette représentation`,
    );
  }
  // Un seau plus fin que le grain de l'agrégat ne peut pas en sortir : une heure
  // agrégée ne se redécoupe pas en tranches de 5 minutes.
  if (plan.visualization === "timeseries" && query.range.bucketSeconds % source.grainSeconds !== 0) {
    return refus(`${source.label} a un grain d'une heure, plus large que le seau demandé`);
  }
  return { usable: true, source, answer };
}

/** Premier agrégat capable de répondre, ou la raison du dernier refus examiné. */
export function chooseRollup(plan: ExplorerPlan, query: AnalyticsQuery): RollupDecision {
  let dernier: RollupDecision = refus("aucun agrégat ne porte ce jeu de données");
  for (const id of ROLLUP_IDS) {
    const decision = rollupAnswers(rollupSource(id), plan, query);
    if (decision.usable) return decision;
    // On ne garde que le refus d'un agrégat qui portait DÉJÀ la mesure : dire
    // « l'histogramme des Web Vitals ne porte pas les erreurs » n'aide personne.
    if (rollupSource(id).answers.some((a) => a.dataset === plan.dataset && a.field === plan.measure.field)) {
      dernier = decision;
    }
  }
  return dernier;
}

/**
 * Capacité d'agrégat DÉCLARÉE par le registre, pour un couple jeu/mesure — ce que
 * `GET /api/v1/explorer/schema` publie. Elle dit ce que l'agrégat SAIT faire, pas
 * ce qu'une requête donnée obtiendra : les dimensions et la population de la
 * requête tranchent au moment de l'exécution.
 */
export interface RollupCapability {
  source: string;
  aggregations: Aggregation[];
  /** Dimensions compatibles : au-delà, la lecture repasse sur les lignes brutes. */
  dimensions: Dimension[];
  visualizations: Visualization[];
  approximate: boolean;
  grain_seconds: number;
  /** L'agrégat inclut les robots : il ne sert alors qu'une mesure qui les inclut. */
  includes_bots: boolean;
}

export function rollupCapability(dataset: ExplorerDatasetId, field: string): RollupCapability | null {
  for (const id of ROLLUP_IDS) {
    const source = rollupSource(id);
    // Une source sans filigrane n'est jamais lue : la publier comme une capacité
    // promettrait ce qu'aucune requête n'obtiendra.
    if (!source.state) continue;
    const answer = source.answers.find((a) => a.dataset === dataset && a.field === field);
    if (!answer) continue;
    return {
      source: source.id,
      aggregations: [...answer.aggregations],
      dimensions: [...source.dimensions],
      visualizations: [...answer.visualizations],
      approximate: source.approximate,
      grain_seconds: source.grainSeconds,
      includes_bots: source.includesBots,
    };
  }
  return null;
}

// ─────────────────── Ce que le schéma doit porter pour lire ──────────────────
//
// La console est publiée avant que la migration ne tourne : la lecture hybride
// SONDE son schéma et retombe sur les lignes brutes tant qu'il manque une
// colonne. Elle ne suppose ni `observed_count`, ni la table d'invalidation.

/** Paires `table.colonne` exigées par la lecture hybride. */
export const COLONNES_HYBRIDE = [
  "metric_histogram_hourly.observed_count",
  "metric_histogram_hourly.bucket",
  "metric_histogram_hourly.hour",
  "metric_histogram_hourly.device_type",
  "metric_histogram_hourly.name",
  "metric_histogram_state.refreshed_at",
  "metric_histogram_state.max_metric_id",
  "analytics_rollup_invalidation.hour",
  "analytics_rollup_invalidation.app_id",
  "analytics_rollup_invalidation.source",
] as const;

/** Tables et colonnes à sonder, pour joindre la sonde commune du contrat P6.2. */
export function rollupColumns(): { tables: string[]; columns: string[] } {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const paire of COLONNES_HYBRIDE) {
    const point = paire.indexOf(".");
    tables.add(paire.slice(0, point));
    columns.add(paire.slice(point + 1));
  }
  return { tables: [...tables].sort(), columns: [...columns].sort() };
}

/** Le schéma interrogé porte-t-il tout ce que la lecture hybride exige ? */
export function hybrideDisponible(schema: ReadonlySet<string>): boolean {
  return COLONNES_HYBRIDE.every((paire) => schema.has(paire));
}

// ──────────────────── La partition raw / rollup, et sa preuve ────────────────
//
// La fenêtre est coupée en DEUX intervalles disjoints qui la recouvrent :
//
//   agrégat   les heures ENTIÈREMENT contenues dans la fenêtre ET entièrement
//             couvertes par le dernier rafraîchissement : [plein, couvert) ;
//   brut      tout le reste — l'heure partielle du début, l'heure EN COURS, et
//             tout ce qui suit le filigrane.
//
// L'heure en cours n'est jamais dans le premier intervalle : `couvert` est le
// début de l'heure du filigrane, et le filigrane est toujours dans le passé. Un
// double comptage de l'heure en cours est donc impossible par construction, pas
// par vigilance.

export interface FenetreHybride {
  /** Début du premier intervalle (ISO UTC), ou null s'il est vide. */
  agregatFrom: string | null;
  /** Fin exclusive du premier intervalle (ISO UTC), ou null s'il est vide. */
  agregatTo: string | null;
  /** Vrai si l'agrégat couvre au moins une heure entière de la fenêtre. */
  utilisable: boolean;
}

/**
 * Découpe une fenêtre résolue selon le filigrane du dernier rafraîchissement.
 * `filigrane` nul (agrégat jamais rafraîchi) rend un intervalle vide : tout est
 * lu brut, le résultat reste juste, seul le coût change.
 */
export function fenetreHybride(range: ResolvedRange, filigrane: string | null): FenetreHybride {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const marque = filigrane === null ? null : Date.parse(filigrane);
  if (marque === null || !Number.isFinite(marque)) return { agregatFrom: null, agregatTo: null, utilisable: false };

  // Première heure ENTIÈRE de la fenêtre : celle qui commence à `from` s'il est
  // déjà aligné, la suivante sinon.
  const plein = Math.ceil(from / GRAIN_MS) * GRAIN_MS;
  // Dernière borne entièrement couverte : le début de l'heure du filigrane
  // (l'heure du filigrane est en cours de remplissage), et jamais au-delà de la
  // fenêtre demandée.
  const couvert = Math.min(Math.floor(marque / GRAIN_MS) * GRAIN_MS, Math.floor(to / GRAIN_MS) * GRAIN_MS);
  if (couvert <= plein) return { agregatFrom: null, agregatTo: null, utilisable: false };
  return {
    agregatFrom: new Date(plein).toISOString(),
    agregatTo: new Date(couvert).toISOString(),
    utilisable: true,
  };
}

/**
 * Un instant appartient-il à l'intervalle d'agrégat ? Exposé pour que le test
 * puisse PROUVER la partition sur une grille d'instants, plutôt que de faire
 * confiance à la lecture du SQL.
 */
export function dansAgregat(tsMs: number, fenetre: FenetreHybride): boolean {
  if (!fenetre.utilisable) return false;
  return tsMs >= Date.parse(fenetre.agregatFrom!) && tsMs < Date.parse(fenetre.agregatTo!);
}

// ───────────────────── La fusion des distributions ───────────────────────────

/** Une ligne d'agrégat : un seau, le nombre de mesures observées qu'il porte. */
export interface LigneHistogramme {
  bucket: number | string;
  observed_count: number | string;
}

/**
 * Fusionne des distributions en seaux : un seau présent dans plusieurs heures ou
 * plusieurs apps voit ses effectifs S'AJOUTER. C'est la seule opération légitime
 * sur des histogrammes de même échelle — et elle l'est justement parce que
 * l'échelle est figée (`histogramme.ts`).
 */
export function fusionnerSeaux(lignes: readonly LigneHistogramme[]): SeauPondere[] {
  const par = new Map<number, number>();
  for (const ligne of lignes) {
    const bucket = Number(ligne.bucket);
    const poids = Number(ligne.observed_count);
    if (!Number.isFinite(bucket) || !Number.isFinite(poids) || poids <= 0) continue;
    par.set(bucket, (par.get(bucket) ?? 0) + poids);
  }
  return [...par].map(([bucket, weighted_count]) => ({ bucket, weighted_count }));
}

/**
 * Percentile d'un ensemble de distributions : on FUSIONNE d'abord, on calcule le
 * quantile ensuite.
 *
 * L'ordre importe et c'est tout le sujet : la moyenne des p75 horaires n'est pas
 * le p75 de la journée. Une heure creuse pèse alors autant qu'une heure de pointe,
 * et la valeur rendue ne correspond à aucune mesure réelle. Une somme cumulée sur
 * les seaux, elle, répond à la question posée.
 */
export function percentileFusionne(lignes: readonly LigneHistogramme[], p: number): number | null {
  return percentileDepuisSeaux(fusionnerSeaux(lignes), p);
}

/** Effectif total d'une distribution : le dénominateur du percentile. */
export function effectif(lignes: readonly LigneHistogramme[]): number {
  return fusionnerSeaux(lignes).reduce((somme, seau) => somme + seau.weighted_count, 0);
}
