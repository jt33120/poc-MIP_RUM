// Paramètres d'URL de l'écran `/explorer` (P6.4) — logique PURE, testée.
//
// L'écran ne définit PAS un second contrat : il traduit une query string vers la
// source de plan que `analytics-schema.ts` valide, et retraduit la requête
// exécutée vers une URL partageable. Les filtres globaux (app, plage, appareil,
// dimensions, segment, robots) restent ceux du contrat commun P6.2.
//
// MESURE EN UN SEUL CONTRÔLE. `measure=<champ>:<agrégation>` plutôt que deux
// listes indépendantes : les agrégations dépendent du champ, et un écran rendu
// côté serveur ne peut pas restreindre une seconde liste selon la première. Deux
// listes libres auraient laissé composer « p95 des sessions distinctes », refusé
// seulement après exécution.
//
// LE CURSEUR N'EST PAS DANS LE FORMULAIRE. C'est pourquoi toute modification le
// remet à zéro : un formulaire soumis ne réécrit que ses propres champs, et
// `cursor` n'en est pas un. « Page suivante » est le seul lien qui le pose.
import {
  AGGREGATION_LABELS,
  VISUALIZATION_LABELS,
  datasetDefinition,
  isExplorerDataset,
  type Aggregation,
  type ExplorerDatasetId,
  type ExplorerPlan,
  type ExplorerPlanSource,
} from "./analytics-schema";
import {
  DIMENSION_LABELS,
  conditionsOf,
  hrefWithQuery,
  queryToSearchParams,
  type AnalyticsQuery,
  type ParamReader,
} from "./query-contract";

/** Paramètres propres à l'écran : tout le reste appartient au contrat commun. */
export const EXPLORER_PARAMS = ["dataset", "measure", "prop", "variant", "g0", "g1", "viz", "limit", "run", "cursor"] as const;

/** Jeu de données du premier affichage : celui que toute app possède. */
export const DATASET_DEFAUT: ExplorerDatasetId = "views";

/** Une mesure telle qu'elle s'écrit dans l'URL et dans la liste déroulante. */
export interface ChoixMesure {
  valeur: string;
  libelle: string;
  field: string;
  aggregation: Aggregation;
  /** La mesure exige une propriété numérique déclarée. */
  property: boolean;
}

/** Toutes les mesures d'un jeu : un couple champ × agrégation par entrée. */
export function mesuresDe(dataset: ExplorerDatasetId): ChoixMesure[] {
  const definition = datasetDefinition(dataset);
  return Object.entries(definition.fields).flatMap(([field, definitionChamp]) =>
    definitionChamp.aggregations.map((aggregation) => ({
      valeur: `${field}:${aggregation}`,
      libelle: `${AGGREGATION_LABELS[aggregation]} — ${definitionChamp.label}`,
      field,
      aggregation,
      property: definitionChamp.kind === "json",
    })),
  );
}

/** Première mesure du jeu : ce que le formulaire propose quand l'URL n'en porte pas. */
export function mesureDefaut(dataset: ExplorerDatasetId): string {
  return mesuresDe(dataset)[0].valeur;
}

/** Jeu de données valide porté par l'URL, ou le défaut. Sert à rendre le formulaire. */
export function datasetChoisi(sp: ParamReader): ExplorerDatasetId {
  const demande = sp.get("dataset")?.trim();
  return demande && isExplorerDataset(demande) ? demande : DATASET_DEFAUT;
}

/**
 * Query string → source de plan. Aucune validation ici : elle appartient au
 * registre, qui refuse d'une seule façon pour l'écran, l'API et l'outil MCP.
 * Une valeur illisible reste illisible et sera refusée, jamais rabattue sur une
 * autre mesure que celle affichée.
 */
export function explorerSource(sp: ParamReader): ExplorerPlanSource {
  const texte = (nom: string): string | undefined => {
    const valeur = sp.get(nom)?.trim();
    return valeur ? valeur : undefined;
  };
  const dataset = datasetChoisi(sp);
  const [field = "", aggregation = ""] = (texte("measure") ?? mesureDefaut(dataset)).split(":");
  const groupBy = [texte("g0"), texte("g1")].filter((valeur): valeur is string => valeur !== undefined);
  const limit = texte("limit");
  return {
    dataset: texte("dataset") ?? dataset,
    measure: { aggregation, field, property: texte("prop") },
    variant: texte("variant") ?? null,
    visualization: texte("viz") ?? "value",
    groupBy,
    limit: limit === undefined ? undefined : Number(limit),
    cursor: texte("cursor"),
  };
}

/** L'utilisateur a-t-il demandé l'exécution ? Sans cela, l'écran invite à le faire. */
export function explorerDemande(sp: ParamReader): boolean {
  return sp.get("run") === "1";
}

/** Champs du plan, tels qu'ils s'écrivent dans une URL. */
export function explorerPlanParams(plan: ExplorerPlan): Record<string, string | null> {
  return {
    dataset: plan.dataset,
    measure: `${plan.measure.field}:${plan.measure.aggregation}`,
    prop: plan.measure.property ?? null,
    variant: plan.variant,
    g0: plan.groupBy[0] ?? null,
    g1: plan.groupBy[1] ?? null,
    viz: plan.visualization,
    limit: String(plan.limit),
    run: "1",
  };
}

/**
 * Lien vers l'Explorer conservant filtres globaux ET plan. `extra` pose le
 * curseur d'une page suivante ; `null` retire un paramètre.
 */
export function explorerHref(
  query: AnalyticsQuery,
  plan: ExplorerPlan,
  extra: Record<string, string | null> = {},
): string {
  return hrefWithQuery("/explorer", query, { ...explorerPlanParams(plan), cursor: null, ...extra });
}

/** Explorer vierge sur un jeu donné, filtres globaux conservés — le builder repart à zéro. */
export function explorerDatasetHref(query: AnalyticsQuery, dataset: ExplorerDatasetId): string {
  return hrefWithQuery("/explorer", query, { dataset });
}

/** Retour à un Explorer vierge, filtres globaux conservés. */
export function explorerResetHref(query: AnalyticsQuery): string {
  const params = queryToSearchParams(query).toString();
  return params ? `/explorer?${params}` : "/explorer";
}

const OPERATEURS: Record<string, string> = { eq: "=", neq: "≠", is_null: "inconnu" };

/**
 * Résumé en français de ce qui a RÉELLEMENT été appliqué — pas de ce qui a été
 * demandé. Il énumère la mesure, la fenêtre, le périmètre effectif, chaque
 * condition et le regroupement ; sans aucune condition, il le DIT, plutôt que de
 * laisser croire à un filtrage muet.
 */
export function explorerResume(query: AnalyticsQuery, plan: ExplorerPlan, fenetre: string): string {
  const definition = datasetDefinition(plan.dataset);
  const field = definition.fields[plan.measure.field];
  const morceaux: string[] = [
    `${AGGREGATION_LABELS[plan.measure.aggregation]} — ${field.label.toLowerCase()}${
      plan.measure.property ? ` « ${plan.measure.property} »` : ""
    } sur ${definition.label.toLowerCase()}`,
  ];
  if (plan.variant !== null && definition.variant) {
    morceaux.push(`${definition.variant.label.toLowerCase()} ${plan.variant}`);
  }
  morceaux.push(`fenêtre ${fenetre}`);
  const apps = query.scope.effectiveApps;
  morceaux.push(apps === null ? "toutes les applications autorisées" : `application ${apps.join(", ")}`);

  const conditions = conditionsOf(query.filters);
  morceaux.push(
    conditions.length
      ? conditions
          .map((c) =>
            c.operator === "is_null"
              ? `${DIMENSION_LABELS[c.dimension]} inconnu`
              : `${DIMENSION_LABELS[c.dimension]} ${OPERATEURS[c.operator]} ${c.value}`,
          )
          .join(", ")
      : "aucun filtre de dimension",
  );
  morceaux.push(query.filters.includeBots ? "robots inclus" : "robots exclus");
  if (query.filters.includeInternal) morceaux.push("applications internes incluses");
  if (plan.groupBy.length) {
    morceaux.push(`groupé par ${plan.groupBy.map((d) => DIMENSION_LABELS[d].toLowerCase()).join(" puis ")}`);
  }
  morceaux.push(`${VISUALIZATION_LABELS[plan.visualization].toLowerCase()}, ${plan.limit} au plus`);
  return `${morceaux.join(" · ")}.`;
}

/** Libellé lisible d'une clé de groupe : un tuple, « Inconnu » pour une valeur absente. */
export function libelleCle(key: Array<string | null>): string {
  return key.length ? key.map((valeur) => valeur ?? "Inconnu").join(" · ") : "Ensemble de la population";
}
