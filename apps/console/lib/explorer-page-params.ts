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
  fieldDefinition,
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
  DEVICES,
  DIMENSION_LABELS,
  PARAM_DIMENSIONS,
  PRESET_LABELS,
  conditionsOf,
  hrefWithQuery,
  previousRange,
  queryToSearchParams,
  serializeSegments,
  type AnalyticsFilters,
  type AnalyticsQuery,
  type Device,
  type Dimension,
  type FilterCondition,
  type ParamReader,
  type ResolvedRange,
} from "./query-contract";
import { estVital, formatDuVital, type FormatId, type VitalName } from "./fmt-ids";
import { CORE_VITALS } from "./rating";

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

// ───────────────────────── F32 — représentations du résultat ─────────────────────────
//
// Une seule traduction « résultat Explorer → figure » (`ResultatAnalyse`, § 4.3), pour
// l'Explorer et les cartes de tableau de bord. Ce qui suit en est la logique PURE.

/**
 * RÈGLE R-V (§ 1.5, § 5.21.4) — le verdict Web Vitals est réservé au p75. Les seuils
 * de `lib/rating.ts` sont ceux de web.dev POUR LE P75 : une moyenne ou un p95 de LCP
 * noté « Bon » serait un verdict inventé (CE13). Cette fonction est la SEULE porte :
 * la prop `vital` d'une tuile ou d'une série, et la couleur de verdict d'un
 * classement, ne reçoivent que son résultat — jamais `plan.variant` directement.
 */
export function vitalDeVerdict(plan: Pick<ExplorerPlan, "dataset" | "measure" | "variant">): VitalName | null {
  if (plan.dataset !== "vitals") return null;
  if (plan.measure.field !== "value" || plan.measure.aggregation !== "p75") return null;
  const variante = plan.variant;
  return variante !== null && CORE_VITALS.includes(variante) && estVital(variante) ? variante : null;
}

/**
 * Phrase de lecture exigée par R-V quand un vital est mesuré autrement qu'au p75 :
 * elle dit pourquoi la figure n'a ni badge, ni teinte, ni bande. `null` ailleurs.
 */
export function phraseSansVerdict(plan: Pick<ExplorerPlan, "dataset" | "measure" | "variant">): string | null {
  if (plan.dataset !== "vitals" || plan.measure.field !== "value") return null;
  const aggregation = plan.measure.aggregation;
  if (aggregation !== "avg" && aggregation !== "p95") return null;
  return `Seuils web.dev définis pour le p75 : aucun verdict n'est donné pour ${aggregation === "avg" ? "la moyenne" : "le p95"}.`;
}

/**
 * Format d'affichage d'une mesure. Il ne dépend PAS du verdict : un LCP moyen reste
 * une durée (`ms`), un CLS reste sans unité (`cls`), quelle que soit l'agrégation.
 * Un dénombrement (lignes, distincts) est un compte ; une propriété déclarée par
 * l'application n'a pas d'unité connue : deux décimales, jamais un arrondi muet.
 */
export function formatDeMesure(plan: Pick<ExplorerPlan, "dataset" | "measure" | "variant">): FormatId {
  const { aggregation, field } = plan.measure;
  if (aggregation === "count" || aggregation === "distinct") return "count";
  if (plan.dataset === "vitals" && field === "value") {
    return plan.variant !== null && estVital(plan.variant) ? formatDuVital(plan.variant) : "ms";
  }
  const champ = fieldDefinition(plan.dataset, field);
  if (champ?.unit === "ms") return "ms";
  if (champ?.unit === "octets") return "bytes";
  if (champ?.kind === "json") return "ratio";
  return "count";
}

/**
 * Nom de la mesure, dans les mots de l'écran : la métrique pour une valeur de Web
 * Vital (« LCP »), sinon le libellé du champ, suivi de la variante choisie
 * (« Tâches longues (loaf) »).
 */
export function nomMesure(plan: Pick<ExplorerPlan, "dataset" | "measure" | "variant">): string {
  if (plan.dataset === "vitals" && plan.measure.field === "value" && plan.variant !== null) return plan.variant;
  const definition = datasetDefinition(plan.dataset);
  const champ = fieldDefinition(plan.dataset, plan.measure.field);
  const propriete = plan.measure.property ? ` « ${plan.measure.property} »` : "";
  const variante = plan.variant !== null && definition.variant ? ` (${plan.variant})` : "";
  return `${champ?.label ?? plan.measure.field}${propriete}${variante}`;
}

/** « LCP — p75 », « Occurrences — Somme » : ce qu'une valeur mesure (W-E3). */
export function libelleMesure(plan: Pick<ExplorerPlan, "dataset" | "measure" | "variant">): string {
  return `${nomMesure(plan)} — ${AGGREGATION_LABELS[plan.measure.aggregation]}`;
}

/**
 * Titre de la figure selon la représentation (§ 5.21.4) : W-E3 « <Mesure> —
 * <agrégation> », W-E4 « <Mesure> par <dimension> », W-E5 « <Mesure> dans le
 * temps[, par <dimension>] », W-E6 « Lignes du résultat ».
 */
export function titreResultat(plan: ExplorerPlan): string {
  const dimensions = plan.groupBy.map((d) => DIMENSION_LABELS[d].toLowerCase()).join(" puis ");
  switch (plan.visualization) {
    case "value":
      return libelleMesure(plan);
    case "toplist":
      return dimensions ? `${libelleMesure(plan)} par ${dimensions}` : libelleMesure(plan);
    case "timeseries":
      return `${libelleMesure(plan)} dans le temps${dimensions ? `, par ${dimensions}` : ""}`;
    case "table":
      return "Lignes du résultat";
  }
}

/**
 * Référence d'une comparaison à la période précédente, écrite en clair (P4, § 3.12) :
 * « vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC) ». Les bornes sont celles
 * de `previousRange`, en UTC — le fuseau des fenêtres du contrat (V6).
 */
export function referencePrecedente(range: ResolvedRange): string {
  const precedente = previousRange(range);
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const duree = range.preset ? `${PRESET_LABELS[range.preset]} précédentes` : "période précédente";
  return `vs ${duree} (${fmt.format(new Date(precedente.from))} → ${fmt.format(new Date(precedente.to))} UTC)`;
}

/**
 * Filtres qui isolent un groupe du résultat (drill-down P8, § 3.3) : une condition
 * par dimension du regroupement. Une valeur connue d'une dimension à paramètre
 * dédié (`route`, `browser`… ou `device` pour un appareil du contrat) le pose, sauf
 * si ce paramètre est déjà pris — elle passe alors par `seg`, comme toute autre
 * dimension ; le groupe « Inconnu » devient `seg=v2:<dim>:is_null`, jamais un
 * paramètre vide.
 */
export function filtresDuGroupe(
  filters: AnalyticsFilters,
  groupBy: readonly Dimension[],
  key: readonly (string | null)[],
): AnalyticsFilters {
  let out: AnalyticsFilters = { ...filters, segments: [...filters.segments] };
  groupBy.forEach((dimension, rang) => {
    const valeur = key[rang] ?? null;
    if (valeur === null) {
      out = { ...out, segments: [...out.segments, { dimension, operator: "is_null", value: null }] };
      return;
    }
    if (dimension === "device" && out.device === undefined && estAppareil(valeur)) {
      out = { ...out, device: valeur };
      return;
    }
    const dediee = PARAM_DIMENSIONS.find((d) => d === dimension);
    if (dediee && out[dediee] === undefined) {
      out = { ...out, [dediee]: valeur };
      return;
    }
    out = { ...out, segments: [...out.segments, { dimension, operator: "eq", value: valeur }] };
  });
  return out;
}

function estAppareil(valeur: string): valeur is Device {
  return (DEVICES as readonly string[]).includes(valeur);
}

/**
 * Lien d'un groupe du résultat : le MÊME Explorer, filtré sur ce groupe, exécuté,
 * sans curseur. La plage (`period` ou `from`/`to`) et la population suivent ; `extra`
 * porte les réglages de vue (`cmp`…).
 */
export function groupeHref(
  query: AnalyticsQuery,
  plan: ExplorerPlan,
  key: readonly (string | null)[],
  extra: Record<string, string | null> = {},
): string {
  return explorerHref({ ...query, filters: filtresDuGroupe(query.filters, plan.groupBy, key) }, plan, extra);
}
