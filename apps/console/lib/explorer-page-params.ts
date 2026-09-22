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
  DEFAULT_ROWS,
  MAX_GROUPS,
  VISUALIZATIONS,
  VISUALIZATION_LABELS,
  datasetDefinition,
  isExplorerDataset,
  parseAstFilters,
  parseExplorerPlan,
  type Aggregation,
  type ExplorerDatasetId,
  type ExplorerPlan,
  type ExplorerPlanSource,
  type Visualization,
} from "./analytics-schema";
import {
  DIMENSION_LABELS,
  PARAM_DIMENSIONS,
  conditionsOf,
  hrefWithQuery,
  queryToSearchParams,
  serializeSegments,
  type AnalyticsFilters,
  type AnalyticsQuery,
  type FilterCondition,
  type ParamReader,
} from "./query-contract";

/** Paramètres propres à l'écran : tout le reste appartient au contrat commun. */
export const EXPLORER_PARAMS = ["dataset", "measure", "prop", "variant", "g0", "g1", "viz", "limit", "run", "cursor"] as const;

/**
 * Limites proposées par représentation. Elles restent dans les bornes du contrat
 * (50 combinaisons, 200 lignes) et sont resserrées là où l'affichage l'exige :
 * au-delà de CINQ courbes superposées, une série cesse d'être lisible (P14, CE6 —
 * l'option « 10 » a disparu). Le registre accepte jusqu'à 50 groupes : une série
 * demandée par l'URL au-delà de cinq est donc refusée par l'écran, avant toute
 * lecture (`SERIES_MAX`), jamais rabattue en silence.
 */
export const LIMITES = { toplist: [5, 10, 20, MAX_GROUPS], timeseries: [1, 3, 5], table: [25, 50, 100, 200] } as const;
export const SERIES_MAX = Math.max(...LIMITES.timeseries);

/** Limite retenue quand la courante n'est pas proposée par la représentation visée. */
const LIMITE_DEFAUT = { value: 10, toplist: 10, timeseries: SERIES_MAX, table: DEFAULT_ROWS } as const;

/**
 * Limite à écrire en passant à une représentation : la courante si cette
 * représentation la propose, sinon son défaut. Un changement d'onglet ne doit
 * jamais fabriquer une requête refusée (« 20 séries », « 200 valeurs uniques ») :
 * c'est un geste de lecture, pas une nouvelle composition.
 */
export function limitePour(viz: Visualization, courante: number | null): number {
  if (viz === "value") return LIMITE_DEFAUT.value;
  const proposees: readonly number[] = LIMITES[viz];
  return courante !== null && proposees.includes(courante) ? courante : LIMITE_DEFAUT[viz];
}

/** Représentation portée par l'URL, si elle existe ; sinon « Valeur ». Sert le formulaire et les onglets. */
export function representationDemandee(sp: ParamReader): Visualization {
  const viz = sp.get("viz")?.trim();
  return viz && (VISUALIZATIONS as readonly string[]).includes(viz) ? (viz as Visualization) : "value";
}

/**
 * Lien d'un onglet de représentation (§ 5.21.3, zone 5). Il garde TOUTE la
 * requête — population, plage, jeu, mesure, variante, regroupements — et ne
 * change que `viz` (plus `limit` quand la représentation visée ne propose pas la
 * courante). `run` est conservé tel quel : exécutée, l'analyse se relance sous
 * la nouvelle forme (un clic est un geste explicite) ; pas encore exécutée, elle
 * ne l'est toujours pas. Le curseur, lui, ne pagine qu'un journal donné : il reste
 * derrière. Construit depuis les paramètres BRUTS, pour qu'une requête refusée
 * garde ses onglets (et que la corriger ne passe pas par l'effacer).
 */
export function explorerOngletHref(
  query: AnalyticsQuery,
  sp: ParamReader,
  viz: Visualization,
  extra: Record<string, string | null> = {},
): string {
  const plan: Record<string, string | null> = {};
  for (const nom of EXPLORER_PARAMS) plan[nom] = sp.get(nom)?.trim() || null;
  const courante = plan.limit !== null && /^\d+$/.test(plan.limit) ? Number(plan.limit) : null;
  return hrefWithQuery("/explorer", query, {
    ...plan,
    ...extra,
    viz,
    limit: String(limitePour(viz, courante)),
    run: plan.run === "1" ? "1" : null,
    cursor: null,
  });
}

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
  morceaux.push(conditions.length ? conditions.map(libelleCondition).join(", ") : "aucun filtre de dimension");
  morceaux.push(query.filters.includeBots ? "robots inclus" : "robots exclus");
  if (query.filters.includeInternal) morceaux.push("applications internes incluses");
  if (plan.groupBy.length) {
    morceaux.push(`groupé par ${plan.groupBy.map((d) => DIMENSION_LABELS[d].toLowerCase()).join(" puis ")}`);
  }
  morceaux.push(`${VISUALIZATION_LABELS[plan.visualization].toLowerCase()}, ${plan.limit} au plus`);
  return `${morceaux.join(" · ")}.`;
}

/** Une pastille de la requête appliquée (`QueryPills`, § 4.3). */
export interface Pastille {
  cle: string;
  libelle: string;
  /** `null` : l'élément est obligatoire, et `raison` dit pourquoi. */
  retirerHref: string | null;
  raison?: string;
}

/** Libellé d'une condition, dans les mots du résumé : « Release = 1.4.2 », « Navigateur inconnu ». */
function libelleCondition(c: FilterCondition): string {
  return c.operator === "is_null"
    ? `${DIMENSION_LABELS[c.dimension]} inconnu`
    : `${DIMENSION_LABELS[c.dimension]} ${OPERATEURS[c.operator]} ${c.value}`;
}

/**
 * Conditions de population, chacune avec les filtres SANS elle. Une condition
 * portée par un paramètre dédié (`device`, `route`, `browser`…) le perd ; une
 * condition de segment est retirée de `seg` à son rang — deux conditions
 * identiques restent deux pastilles, et n'en retirer qu'une ne retire qu'elle.
 */
function conditionsRetirables(filters: AnalyticsFilters): { condition: FilterCondition; sans: AnalyticsFilters }[] {
  const out: { condition: FilterCondition; sans: AnalyticsFilters }[] = [];
  if (filters.device) {
    out.push({ condition: { dimension: "device", operator: "eq", value: filters.device }, sans: { ...filters, device: undefined } });
  }
  for (const dimension of PARAM_DIMENSIONS) {
    const value = filters[dimension];
    if (value !== undefined) out.push({ condition: { dimension, operator: "eq", value }, sans: { ...filters, [dimension]: undefined } });
  }
  filters.segments.forEach((condition, rang) => {
    out.push({ condition, sans: { ...filters, segments: filters.segments.filter((_, i) => i !== rang) } });
  });
  return out;
}

/**
 * La requête APPLIQUÉE, élément par élément (§ 5.21.3, zone 3) : jeu, mesure,
 * variante, regroupements, chaque condition de population, robots et apps
 * internes. Chaque pastille retirable porte le lien de la même analyse SANS elle
 * — toujours exécutée (retirer est un geste explicite), jamais avec un curseur
 * (la population a changé : une page prélevée dans l'ancienne serait fausse).
 * Ce qui ne peut pas être retiré le dit : un jeu, une mesure et une variante
 * obligatoire n'ont pas d'« absence ».
 */
export function pastillesRequete(
  query: AnalyticsQuery,
  plan: ExplorerPlan,
  extra: Record<string, string | null> = {},
): Pastille[] {
  const definition = datasetDefinition(plan.dataset);
  const champ = definition.fields[plan.measure.field];
  const lien = (q: AnalyticsQuery, p: ExplorerPlan) => explorerHref(q, p, extra);
  const pastilles: Pastille[] = [
    {
      cle: "jeu",
      libelle: `Jeu : ${definition.label}`,
      retirerHref: null,
      raison: "une analyse porte toujours sur un jeu de données : en changer par la rangée « Jeu de données »",
    },
    {
      cle: "mesure",
      libelle: `${AGGREGATION_LABELS[plan.measure.aggregation]} — ${champ.label}${
        plan.measure.property ? ` « ${plan.measure.property} »` : ""
      }`,
      retirerHref: null,
      raison: "une analyse mesure toujours quelque chose : en changer par « Modifier la requête »",
    },
  ];

  const axe = definition.variant;
  if (plan.variant !== null && axe) {
    const libelle = `${axe.label} : ${plan.variant}`;
    if (champ.variant) {
      pastilles.push({
        cle: "variante",
        libelle,
        retirerHref: null,
        raison: `« ${champ.label} » n’existe que pour ${axe.label.toLowerCase()} = ${champ.variant}`,
      });
    } else if (axe.required) {
      pastilles.push({
        cle: "variante",
        libelle,
        retirerHref: null,
        raison: `${axe.label} est obligatoire pour ${definition.label.toLowerCase()}`,
      });
    } else {
      pastilles.push({ cle: "variante", libelle, retirerHref: lien(query, { ...plan, variant: null }) });
    }
  }

  plan.groupBy.forEach((dimension, rang) => {
    pastilles.push({
      cle: `groupe-${dimension}`,
      libelle: `${rang === 0 ? "Groupé par" : "Puis par"} ${DIMENSION_LABELS[dimension].toLowerCase()}`,
      retirerHref: lien(query, { ...plan, groupBy: plan.groupBy.filter((d) => d !== dimension) }),
    });
  });

  conditionsRetirables(query.filters).forEach(({ condition, sans }, rang) => {
    pastilles.push({
      cle: `condition-${rang}`,
      libelle: libelleCondition(condition),
      retirerHref: lien({ ...query, filters: sans }, plan),
    });
  });

  pastilles.push(
    query.filters.includeBots
      ? {
          cle: "robots",
          libelle: "Robots inclus",
          retirerHref: lien({ ...query, filters: { ...query.filters, includeBots: false } }, plan),
        }
      : {
          cle: "robots",
          libelle: "Robots exclus",
          retirerHref: null,
          raison: "exclus par défaut : les inclure se règle dans les filtres de population",
        },
  );
  if (query.filters.includeInternal) {
    pastilles.push({
      cle: "internes",
      libelle: "Applications internes incluses",
      retirerHref: lien({ ...query, filters: { ...query.filters, includeInternal: false } }, plan),
    });
  }
  return pastilles;
}

/**
 * AST canonique enregistré → URL de l'Explorer, prête à exécuter. Sert les vues
 * enregistrées (P6.5) : rouvrir une vue, c'est rejouer sa requête sur l'écran, pas
 * afficher un résultat figé. Un AST illisible rend sa RAISON — la vue reste
 * renommable et supprimable, elle n'est pas effacée en silence.
 */
export function explorerHrefFromAst(ast: unknown): { ok: true; href: string } | { ok: false; reason: string } {
  if (typeof ast !== "object" || ast === null || Array.isArray(ast)) {
    return { ok: false, reason: "la requête enregistrée n’est pas un objet JSON" };
  }
  const source = ast as Record<string, unknown>;
  const plan = parseExplorerPlan(
    {
      dataset: source.dataset,
      measure: source.measure,
      variant: source.variant ?? null,
      visualization: source.visualization,
      groupBy: source.groupBy,
      limit: source.limit,
    },
    null,
  );
  if (!plan.ok) return { ok: false, reason: plan.error.message };
  const conditions = parseAstFilters(source.filters);
  if (!conditions.ok) return { ok: false, reason: conditions.error.message };

  const params = new URLSearchParams();
  if (typeof source.app === "string" && source.app) params.set("app", source.app);
  const range = source.range;
  if (typeof range === "object" && range !== null) {
    const r = range as Record<string, unknown>;
    if (typeof r.preset === "string") {
      if (r.preset !== "24h") params.set("period", r.preset);
    } else if (typeof r.from === "string" && typeof r.to === "string") {
      params.set("from", r.from);
      params.set("to", r.to);
    }
  }
  const seg = serializeSegments(conditions.value);
  if (seg) params.set("seg", seg);
  if (source.includeBots === true) params.set("bots", "1");
  if (source.includeInternal === true) params.set("internal", "1");
  for (const [nom, valeur] of Object.entries(explorerPlanParams(plan.value))) {
    if (valeur !== null) params.set(nom, valeur);
  }
  return { ok: true, href: `/explorer?${params.toString()}` };
}

/** Libellé lisible d'une clé de groupe : un tuple, « Inconnu » pour une valeur absente. */
export function libelleCle(key: Array<string | null>): string {
  return key.length ? key.map((valeur) => valeur ?? "Inconnu").join(" · ") : "Ensemble de la population";
}
