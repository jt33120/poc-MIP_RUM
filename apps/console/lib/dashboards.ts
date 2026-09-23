// Tableaux de bord configurables — helpers PURS (catalogue de widgets, lecture et
// écriture du layout). Aucun accès base ici (testable).
//
// DEUX VERSIONS DE WIDGET, UNE SEULE LECTURE.
//   · v1 (P1) : les six types du catalogue historique, chacun branché sur une
//     requête écrite à la main. Ils restent lisibles et modifiables TELS QUELS.
//   · v2 (P6.5) : un AST analytique canonique (`lib/analytics-schema.ts`), une
//     représentation, des filtres propres à la carte et une fenêtre facultative.
//
// L'ADAPTATEUR EST EN LECTURE. `normalizeLayout` traduit le jsonb stocké vers un
// modèle unique en mémoire ; `serializeLayout` réécrit CHAQUE widget dans sa
// version d'origine. Ouvrir un tableau de bord v1 ne le convertit donc pas, et un
// retour arrière applicatif retrouve exactement le JSON qu'il avait écrit.
//
// UN WIDGET INVALIDE NE DISPARAÎT PAS. La v1 écartait silencieusement toute
// entrée qu'elle ne comprenait pas : un layout écrit par une version plus récente
// perdait ses cartes à la première écriture. Une entrée illisible devient
// désormais un widget `invalid` qui porte sa raison et son JSON d'origine —
// affiché en carte de diagnostic, réécrit intact, corrigible par un admin.
//
// LES SECTIONS SONT DES ÉLÉMENTS DU LAYOUT (F37, W-B12). Un titre de section
// (`kind: "section"`) ouvre un groupe : les cartes qui le suivent, jusqu'à la
// section suivante, sont les siennes. Aucune migration : la colonne `layout` est
// déjà une liste. Le jsonb d'une section ne porte PAS `kind` (un lecteur d'avant
// F37 prendrait un objet à `kind` pour un widget déjà normalisé et le passerait
// tel quel au rendu) mais `type: "section"`, hors du catalogue v1 : ce lecteur-là
// la lit comme une carte illisible et la réécrit intacte — rien n'est perdu en
// cas de retour arrière. Une section compte dans `MAX_WIDGETS`, comme une carte :
// la borne de lecture d'un tableau ne change pas.
import {
  EXPLORER_VERSION,
  VISUALIZATIONS,
  isExplorerDataset,
  parseAstFilters,
  parseExplorerPlan,
  type ExplorerPlan,
  type Visualization,
} from "./analytics-schema";
import {
  DIMENSION_LABELS,
  MAX_CONDITIONS,
  RANGE_MAX_MS,
  RANGE_PRESETS,
  parseUtcInstant,
  type FilterCondition,
  type RangePreset,
} from "./query-contract";

export const WIDGET_TYPES = [
  "vital_p75",
  "traffic",
  "slow_routes",
  "top_errors",
  "frustration",
  "event_count",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

/** Version de configuration d'un widget analytique. Les v1 n'en portent aucune. */
export const WIDGET_SCHEMA_VERSION = 2 as const;
/** Discriminant des widgets v2 dans le jsonb : un lecteur v1 l'ignore comme un type inconnu. */
export const ANALYTICS_WIDGET_TYPE = "analytics" as const;
/** Discriminant d'un titre de section dans le jsonb (F37) : hors du catalogue v1, comme `analytics`. */
export const SECTION_WIDGET_TYPE = "section" as const;

/** Éléments d'un tableau, SECTIONS COMPRISES (F37) : la borne de lecture d'un tableau. */
export const MAX_WIDGETS = 24;
const TITLE_MAX = 60;
/** Longueur d'une question de section : une phrase, pas un paragraphe. */
export const QUESTION_MAX = 120;

/** Widget v1 : un type du catalogue, sa métrique ou son nom d'événement. */
export interface LegacyWidget {
  kind: "v1";
  type: WidgetType;
  title: string;
  metric?: string; // requis pour vital_p75 (LCP|INP|…)
  eventName?: string; // requis pour event_count
}

/**
 * Fenêtre propre à une carte. Bornée comme toute plage du contrat : un preset
 * glissant, ou deux instants UTC distants de 30 jours au plus. Absente, le widget
 * hérit de la fenêtre globale de l'écran — et le dit sur sa carte.
 */
export type RangeOverride = { preset: RangePreset } | { from: string; to: string };

/**
 * Widget v2 : une analyse enregistrée. `plan` porte le QUOI (jeu, mesure,
 * regroupement, limite) déjà validé ; `conditions` les filtres de l'AST ;
 * `filters` ceux ajoutés sur la carte. Les deux listes sont des ET, jamais des
 * remplacements — et elles s'ajoutent aux filtres globaux de l'écran.
 *
 * Ni l'app ni la fenêtre ne sont stockées : elles appartiennent au tableau de
 * bord qui lit le widget. Un widget ne peut donc pas mesurer une autre app que la
 * sienne, ni figer une fenêtre à l'insu de l'écran (sauf `rangeOverride`, affiché).
 */
export interface AnalyticsWidget {
  kind: "v2";
  title: string;
  plan: ExplorerPlan;
  conditions: FilterCondition[];
  filters: FilterCondition[];
  /** Le widget n'élargit jamais la population globale : ces drapeaux ne font que la restreindre. */
  includeBots: boolean;
  includeInternal: boolean;
  rangeOverride: RangeOverride | null;
}

/** Entrée illisible : conservée telle quelle, affichée en diagnostic, jamais perdue. */
export interface InvalidWidget {
  kind: "invalid";
  title: string;
  reason: string;
  /** JSON d'origine, réécrit intact tant qu'un admin ne l'a pas corrigé. */
  raw: unknown;
}

/**
 * Titre de section (F37, W-B12) : un `h2` et la question à laquelle répondent les
 * cartes qui le suivent. Il ne lit rien. `question` peut être vide : le titre est
 * alors lui-même la question (« Où ? »).
 */
export interface SectionWidget {
  kind: "section";
  title: string;
  question: string;
}

export type Widget = LegacyWidget | AnalyticsWidget | SectionWidget | InvalidWidget;

/** Ce qui se dessine dans une grille : tout élément du layout sauf un titre de section. */
export type CarteWidget = Exclude<Widget, SectionWidget>;

/** Métadonnées d'affichage/édition par type de widget v1. */
export const WIDGET_META: Record<WidgetType, { label: string; needsMetric: boolean; needsEventName?: boolean }> = {
  vital_p75: { label: "Web Vital (p75)", needsMetric: true },
  traffic: { label: "Trafic (pages vues / erreurs)", needsMetric: false },
  slow_routes: { label: "Routes les plus lentes", needsMetric: false },
  top_errors: { label: "Top erreurs", needsMetric: false },
  frustration: { label: "Signaux de frustration", needsMetric: false },
  event_count: { label: "Événements custom (nombre)", needsMetric: false, needsEventName: true },
};

const isType = (t: unknown): t is WidgetType =>
  typeof t === "string" && (WIDGET_TYPES as readonly string[]).includes(t);

/** Titre par défaut d'un widget v1 (type + métrique éventuelle). */
export function defaultTitle(type: WidgetType, metric?: string, eventName?: string): string {
  if (type === "vital_p75" && metric) return `${metric} p75`;
  if (type === "event_count" && eventName) return `Événements · ${eventName}`;
  return WIDGET_META[type].label;
}

function titreDe(raw: unknown, defaut: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, TITLE_MAX) : defaut;
}

function estObjet(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─────────────────────────── Lecture d'un widget v2 ──────────────────────────

const CLES_V2 = ["schemaVersion", "type", "title", "query", "visualization", "filters", "rangeOverride"] as const;
const CLES_QUERY = [
  "version",
  "dataset",
  "measure",
  "variant",
  "filters",
  "groupBy",
  "limit",
  "includeBots",
  "includeInternal",
] as const;

/** Lecture d'une configuration : la valeur, ou la RAISON du refus — jamais un silence. */
export type WidgetParsed<T> = { ok: true; value: T } | { ok: false; reason: string };
const lu = <T>(value: T): WidgetParsed<T> => ({ ok: true, value });
const refus = (reason: string): WidgetParsed<never> => ({ ok: false, reason });

function clesInconnues(source: Record<string, unknown>, connues: readonly string[]): string | null {
  const inconnue = Object.keys(source).find((key) => !connues.includes(key));
  return inconnue === undefined ? null : inconnue.slice(0, 40);
}

/** Fenêtre propre à la carte : preset glissant, ou deux instants UTC bornés à 30 jours. */
export function parseRangeOverride(raw: unknown): WidgetParsed<RangeOverride | null> {
  if (raw === undefined || raw === null) return lu(null);
  if (!estObjet(raw)) return refus("rangeOverride est un objet { preset } ou { from, to }");
  const inconnue = clesInconnues(raw, ["preset", "from", "to"]);
  if (inconnue) return refus(`clé de fenêtre inconnue : ${inconnue}`);
  const aPreset = raw.preset !== undefined;
  const aBornes = raw.from !== undefined || raw.to !== undefined;
  if (aPreset && aBornes) return refus("une fenêtre de carte porte soit un preset, soit from et to");
  if (aPreset) {
    if (typeof raw.preset !== "string" || !(RANGE_PRESETS as readonly string[]).includes(raw.preset)) {
      return refus(`preset de fenêtre inconnu (${RANGE_PRESETS.join(", ")})`);
    }
    return lu({ preset: raw.preset as RangePreset });
  }
  if (!aBornes) return refus("rangeOverride vide : le retirer plutôt que l'écrire");
  if (typeof raw.from !== "string" || typeof raw.to !== "string") {
    return refus("from et to sont des instants ISO UTC (…Z)");
  }
  const from = parseUtcInstant(raw.from);
  const to = parseUtcInstant(raw.to);
  if (from === null || to === null) return refus("from et to sont des instants ISO UTC (…Z)");
  if (from >= to) return refus("from doit précéder to");
  if (to - from > RANGE_MAX_MS) return refus("la fenêtre d'une carte ne peut pas dépasser 30 jours");
  return lu({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
}

/**
 * Widget v2 stocké → widget validé. Toute la validation vient du registre de
 * l'Explorer : un widget ne peut pas déclarer une mesure, une dimension ou une
 * limite que l'API refuserait.
 */
export function parseAnalyticsWidget(raw: Record<string, unknown>): WidgetParsed<AnalyticsWidget> {
  const inconnue = clesInconnues(raw, CLES_V2);
  if (inconnue) return refus(`clé de widget inconnue : ${inconnue}`);
  const query = raw.query;
  if (!estObjet(query)) return refus("query est l'AST canonique de l'analyse enregistrée");
  const inconnueQuery = clesInconnues(query, CLES_QUERY);
  if (inconnueQuery) return refus(`clé d'AST inconnue : ${inconnueQuery}`);
  if (query.version !== undefined && query.version !== EXPLORER_VERSION) {
    return refus(`version d'AST non supportée (attendue : ${EXPLORER_VERSION})`);
  }
  if (typeof query.dataset !== "string" || !isExplorerDataset(query.dataset)) {
    return refus(`jeu de données inconnu : ${String(query.dataset).slice(0, 40)}`);
  }
  const visualization = raw.visualization;
  if (typeof visualization !== "string" || !(VISUALIZATIONS as readonly string[]).includes(visualization)) {
    return refus(`représentation inconnue (${VISUALIZATIONS.join(", ")})`);
  }
  // Le plan est validé sans fenêtre : elle vient du lecteur, pas de l'enregistrement.
  const plan = parseExplorerPlan(
    {
      dataset: query.dataset,
      measure: query.measure,
      variant: query.variant ?? null,
      visualization,
      groupBy: query.groupBy,
      limit: query.limit,
    },
    null,
  );
  if (!plan.ok) return refus(plan.error.message);

  const conditions = parseAstFilters(query.filters);
  if (!conditions.ok) return refus(conditions.error.message);
  const filters = parseAstFilters(raw.filters);
  if (!filters.ok) return refus(filters.error.message);
  if (conditions.value.length + filters.value.length > MAX_CONDITIONS) {
    return refus(`au plus ${MAX_CONDITIONS} conditions combinées sur une carte`);
  }
  for (const drapeau of ["includeBots", "includeInternal"] as const) {
    if (query[drapeau] !== undefined && typeof query[drapeau] !== "boolean") {
      return refus(`${drapeau} est un booléen`);
    }
  }
  const rangeOverride = parseRangeOverride(raw.rangeOverride);
  if (!rangeOverride.ok) return rangeOverride;

  return lu({
    kind: "v2",
    title: titreDe(raw.title, defaultAnalyticsTitle(plan.value)),
    plan: plan.value,
    conditions: conditions.value,
    filters: filters.value,
    includeBots: query.includeBots === true,
    includeInternal: query.includeInternal === true,
    rangeOverride: rangeOverride.value,
  });
}

/** Titre par défaut d'une analyse enregistrée : sa mesure et son jeu de données. */
export function defaultAnalyticsTitle(plan: ExplorerPlan): string {
  return `${plan.measure.field} · ${plan.dataset}`;
}

/**
 * Carte construite depuis un plan d'Explorer. Ni l'app ni la fenêtre de l'écran
 * ne la suivent : elle héritera de celles du tableau de bord qui l'accueille,
 * sauf `rangeOverride` — explicitement demandé, et affiché sur la carte.
 */
export function widgetFromPlan(
  plan: ExplorerPlan,
  options: {
    title?: string;
    conditions?: FilterCondition[];
    includeBots?: boolean;
    includeInternal?: boolean;
    rangeOverride?: RangeOverride | null;
  } = {},
): AnalyticsWidget {
  return {
    kind: "v2",
    title: options.title?.trim().slice(0, TITLE_MAX) || defaultAnalyticsTitle(plan),
    // Un curseur ne s'enregistre pas : une page n'est pas une analyse.
    plan: { ...plan, cursor: null },
    conditions: options.conditions ?? [],
    filters: [],
    includeBots: options.includeBots === true,
    includeInternal: options.includeInternal === true,
    rangeOverride: options.rangeOverride ?? null,
  };
}

/** Configuration jsonb d'une carte isolée — ce qu'un formulaire transporte. */
export function widgetConfigJson(widget: Widget): unknown {
  return serializeLayout([widget])[0];
}

// ────────────────────────────── Layout complet ───────────────────────────────

/**
 * Normalise un layout (jsonb ou formulaire) vers le modèle unique en mémoire.
 * Borne le nombre de widgets ; ne jette jamais. Une entrée illisible devient un
 * widget de diagnostic — jamais un trou silencieux dans la grille.
 */
export function normalizeLayout(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const item of raw) {
    if (out.length >= MAX_WIDGETS) break;
    out.push(lireWidget(item));
  }
  return out;
}

function lireWidget(item: unknown): Widget {
  // Un widget déjà normalisé (server action, clone) retraverse la même porte.
  if (estObjet(item) && typeof item.kind === "string") return item as unknown as Widget;
  if (!estObjet(item)) {
    return { kind: "invalid", title: "Widget illisible", reason: "la configuration n'est pas un objet", raw: item };
  }
  if (item.type === SECTION_WIDGET_TYPE) {
    const section = lireSection(item);
    return section.ok
      ? section.value
      : { kind: "invalid", title: titreDe(item.title, "Section illisible"), reason: section.reason, raw: item };
  }
  if (item.type === ANALYTICS_WIDGET_TYPE || item.schemaVersion === WIDGET_SCHEMA_VERSION) {
    const analytique = parseAnalyticsWidget(item);
    return analytique.ok
      ? analytique.value
      : { kind: "invalid", title: titreDe(item.title, "Analyse illisible"), reason: analytique.reason, raw: item };
  }
  const legacy = lireWidgetV1(item);
  return legacy.ok
    ? legacy.value
    : { kind: "invalid", title: titreDe(item.title, "Widget illisible"), reason: legacy.reason, raw: item };
}

const CLES_SECTION = ["type", "title", "question"] as const;

/**
 * Titre de section stocké (ou soumis par le formulaire) → section validée. Les clés
 * sont fermées, comme celles d'une analyse : une section écrite par une version
 * plus récente (une clé que celle-ci ignore) devient une carte illisible — son
 * JSON est conservé et réécrit intact —, jamais une section amputée en silence.
 */
function lireSection(item: Record<string, unknown>): WidgetParsed<SectionWidget> {
  const inconnue = clesInconnues(item, CLES_SECTION);
  if (inconnue) return refus(`clé de section inconnue : ${inconnue}`);
  const titre = typeof item.title === "string" ? item.title.trim() : "";
  if (!titre) return refus("une section porte un titre");
  if (item.question !== undefined && typeof item.question !== "string") {
    return refus("la question d’une section est un texte");
  }
  return lu({
    kind: "section",
    title: titre.slice(0, TITLE_MAX),
    question: (item.question ?? "").trim().slice(0, QUESTION_MAX),
  });
}

/**
 * Section soumise par le formulaire « Ajouter une section » (F37). Même porte que
 * le jsonb stocké : une section enregistrée est relue exactement comme elle a été
 * acceptée. Titre vide (des espaces passent l'attribut `required`) → refus dit.
 */
export function sectionDuFormulaire(title: unknown, question: unknown): WidgetParsed<SectionWidget> {
  return lireSection({
    type: SECTION_WIDGET_TYPE,
    title: typeof title === "string" ? title : "",
    question: typeof question === "string" ? question : "",
  });
}

function lireWidgetV1(w: Record<string, unknown>): WidgetParsed<LegacyWidget> {
  if (!isType(w.type)) return refus(`type de widget inconnu : ${String(w.type).slice(0, 40)}`);
  let metric: string | undefined;
  if (WIDGET_META[w.type].needsMetric) {
    const m = typeof w.metric === "string" ? w.metric : "";
    if (!(WIDGET_VITALS as readonly string[]).includes(m)) {
      return refus(`métrique invalide (${WIDGET_VITALS.join(", ")})`);
    }
    metric = m;
  }
  let eventName: string | undefined;
  if (WIDGET_META[w.type].needsEventName) {
    const name = typeof w.eventName === "string" ? w.eventName.trim() : "";
    if (!name || name.length > 100 || /[ -]/.test(name)) return refus("nom d’événement invalide");
    eventName = name;
  }
  return lu({
    kind: "v1",
    type: w.type,
    title: titreDe(w.title, defaultTitle(w.type, metric, eventName)),
    ...(metric ? { metric } : {}),
    ...(eventName ? { eventName } : {}),
  });
}

/** AST canonique d'un widget v2, tel qu'il est stocké (sans app ni fenêtre). */
export function widgetQueryJson(widget: AnalyticsWidget): Record<string, unknown> {
  const { plan } = widget;
  return {
    version: EXPLORER_VERSION,
    dataset: plan.dataset,
    measure: plan.measure.property
      ? { aggregation: plan.measure.aggregation, field: plan.measure.field, property: plan.measure.property }
      : { aggregation: plan.measure.aggregation, field: plan.measure.field },
    ...(plan.variant !== null ? { variant: plan.variant } : {}),
    filters: widget.conditions.map(conditionJson),
    groupBy: plan.groupBy,
    limit: plan.limit,
    ...(widget.includeBots ? { includeBots: true } : {}),
    ...(widget.includeInternal ? { includeInternal: true } : {}),
  };
}

function conditionJson(c: FilterCondition): Record<string, unknown> {
  return c.operator === "is_null"
    ? { field: c.dimension, operator: c.operator }
    : { field: c.dimension, operator: c.operator, type: "string", value: c.value };
}

/**
 * Modèle en mémoire → jsonb à écrire. Chaque widget repart dans SA version : un
 * v1 ressort exactement comme il est entré (aucune clé ajoutée), un invalide
 * ressort tel quel. Seule une carte réellement modifiée change de contenu.
 */
export function serializeLayout(widgets: Widget[]): unknown[] {
  return widgets.slice(0, MAX_WIDGETS).map((w) => {
    if (w.kind === "invalid") return w.raw;
    // Jamais de `kind` dans le jsonb d'une section : voir l'en-tête (lecteur d'avant F37).
    // Une question vide n'est pas écrite, comme une métrique ou une fenêtre absentes.
    if (w.kind === "section") {
      return { type: SECTION_WIDGET_TYPE, title: w.title, ...(w.question ? { question: w.question } : {}) };
    }
    if (w.kind === "v1") {
      return {
        type: w.type,
        title: w.title,
        ...(w.metric ? { metric: w.metric } : {}),
        ...(w.eventName ? { eventName: w.eventName } : {}),
      };
    }
    return {
      schemaVersion: WIDGET_SCHEMA_VERSION,
      type: ANALYTICS_WIDGET_TYPE,
      title: w.title,
      query: widgetQueryJson(w),
      visualization: w.plan.visualization,
      filters: w.filters.map(conditionJson),
      ...(w.rangeOverride ? { rangeOverride: w.rangeOverride } : {}),
    };
  });
}

const OPERATEURS: Record<FilterCondition["operator"], string> = { eq: "=", neq: "≠", is_null: "inconnu" };

/** Filtres portés par une carte, en toutes lettres (« Navigateur = Firefox »). */
export function widgetFiltersLabel(widget: AnalyticsWidget): string | null {
  const conditions = [...widget.conditions, ...widget.filters];
  if (!conditions.length) return null;
  return conditions
    .map((c) =>
      c.operator === "is_null"
        ? `${DIMENSION_LABELS[c.dimension]} inconnu`
        : `${DIMENSION_LABELS[c.dimension]} ${OPERATEURS[c.operator]} ${c.value}`,
    )
    .join(" · ");
}

// ─────────────────────────── Sections (F37, W-B12) ───────────────────────────

/**
 * Un groupe de la grille : le titre de section qui l'ouvre, et ses cartes. Chaque
 * élément garde sa POSITION dans le layout : les formulaires d'ordre et de retrait
 * la citent, et la donnée résolue (`resolveWidgets`) est rangée dans le même ordre.
 */
export interface GroupeDeCartes {
  /** `null` : cartes posées avant toute section (ou tableau sans section — une grille unique). */
  section: { index: number; widget: SectionWidget } | null;
  cartes: { index: number; widget: CarteWidget }[];
}

/**
 * Le layout découpé en groupes, dans l'ordre. Une section vide reste un groupe (son
 * titre s'affiche, avec « aucune carte ») ; les cartes d'avant la première section
 * forment un groupe sans titre. Sans aucune section : un seul groupe, sans titre.
 */
export function groupesDuLayout(layout: Widget[]): GroupeDeCartes[] {
  const groupes: GroupeDeCartes[] = [];
  let courant: GroupeDeCartes = { section: null, cartes: [] };
  layout.forEach((widget, index) => {
    if (widget.kind === "section") {
      if (courant.section !== null || courant.cartes.length) groupes.push(courant);
      courant = { section: { index, widget }, cartes: [] };
      return;
    }
    courant.cartes.push({ index, widget });
  });
  if (courant.section !== null || courant.cartes.length) groupes.push(courant);
  return groupes;
}

/**
 * Le tableau a-t-il atteint `MAX_WIDGETS` éléments, sections comprises ? Alors une
 * carte ou une section de plus est REFUSÉE, et le refus est dit : `serializeLayout`
 * couperait le 25e élément sans rien dire.
 */
export function layoutPlein(layout: Widget[]): boolean {
  return layout.length >= MAX_WIDGETS;
}

/** Nombre de cartes d'un layout : un titre de section n'en est pas une. */
export function nombreDeCartes(layout: Widget[]): number {
  return layout.filter((w) => w.kind !== "section").length;
}

/**
 * La question à écrire sous le titre d'une section, ou `null` : absente, ou
 * identique au titre (un titre déjà formulé en question ne se répète pas). Une
 * seule règle pour la page et pour l'export CSV.
 */
export function questionDeSection(section: SectionWidget): string | null {
  const question = section.question.trim();
  if (!question) return null;
  return question.toLocaleLowerCase("fr") === section.title.trim().toLocaleLowerCase("fr") ? null : question;
}
