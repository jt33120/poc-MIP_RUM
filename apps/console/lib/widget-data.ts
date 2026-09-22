// Résolveur de widget (tableaux de bord) : mappe un Widget + les filtres de
// l'écran vers une forme d'affichage UNIFORME, en réutilisant les lectures
// existantes (v1) ou l'exécuteur de l'Explorer (v2, P6.5). La page de rendu ET
// l'export CSV partagent exactement la même donnée.
//
// CE QU'UN WIDGET NE PEUT PAS FAIRE. Ni changer d'app, ni élargir la population :
// ses filtres s'AJOUTENT à ceux de l'écran (`intersectQuery`), et ses drapeaux
// robots/apps internes ne font que restreindre les drapeaux globaux. Sa fenêtre
// est celle de l'écran, sauf `rangeOverride` — affiché sur la carte.
//
// QUATRE LECTURES À LA FOIS. Vingt-quatre cartes lancées ensemble ouvriraient
// vingt-quatre transactions sur un pool de dix connexions : la grille se charge
// par vagues de quatre. Un signal d'annulation arrête les vagues suivantes — une
// page abandonnée ne continue pas à interroger la base pour personne.
//
// CACHE COURT, PORTÉ AU PÉRIMÈTRE. Deux cartes qui posent la même question, ou
// l'export CSV qui suit l'affichage, ne la posent qu'une fois. La clé contient le
// périmètre EFFECTIF : une réponse calculée pour A ne peut pas servir à B.
import { widgetFiltersLabel, type AnalyticsWidget, type RangeOverride, type Widget } from "./dashboards";
import type { Filters } from "./filters";
import { queryOf } from "./filters";
import { cleJour } from "./forecast";
import { lire } from "./lecture";
import { UnsupportedFilterError } from "./query-compiler";
import { dailyTraffic } from "./queries-grid";
import { topFrustrations } from "./queries-frustration";
import { listErrorGroups } from "./queries-errors";
import { slowRoutes, vitalsP75 } from "./queries";
import { eventCount } from "./queries-events";
import { ExplorerBudgetError, UnsupportedExplorerDimension, type ExplorerPlan } from "./analytics-schema";
import { exploreAnalytics, type ExplorerData, type ExplorerMeta, type ExplorerResult } from "./queries-explorer";
import {
  intersectQuery,
  previousRange,
  queryFingerprint,
  rangeLabel,
  resolveRange,
  type AnalyticsQuery,
  type ResolvedRange,
} from "./query-contract";
// F36 — imports du lot : le format et le verdict d'une carte sont ceux de l'Explorer.
import type { CouverturePrecedente } from "./comparaison";
import { estVital, formatDuVital, type FormatId, type VitalName } from "./fmt-ids";
import { formatDeMesure, phraseSansVerdict, referencePrecedente, vitalDeVerdict } from "./explorer-page-params";
import type { ModeComparaison } from "./view-state";

/** Une carte au plus toutes les quatre : le pool de la console en compte dix. */
export const WIDGET_CONCURRENCY = 4;
/** Mémoire du cache de grille. Assez pour l'affichage puis son export, pas plus. */
export const WIDGET_CACHE_TTL_MS = 10_000;
const WIDGET_CACHE_MAX = 200;

export interface WidgetSeriesGroup {
  label: string;
  /**
   * Une valeur par seau, dans l'ordre de `buckets`. `null` : aucune mesure dans le
   * seau pour une mesure non additive (percentile, moyenne, distincts) — un trou,
   * jamais « 0 » (CE1, V3). Une mesure additive absente d'un seau y vaut 0 : là,
   * zéro est la vérité.
   */
  values: (number | null)[];
}

export interface WidgetRank {
  label: string;
  /** `null` : valeur non calculable pour ce groupe — « — », jamais une barre à 0 (CE2). */
  value: number | null;
  display: string;
  sub?: string;
}

/**
 * Résultat d'analyse d'une carte v2, transporté TEL QUEL jusqu'au rendu (F36,
 * W-B2 à W-B5). La carte ne traduit plus « résultat → figure » de son côté :
 * `ResultatAnalyse` (§ 4.3) est la seule traduction, partagée avec l'Explorer.
 * Deux traductions finiraient par dire deux choses du même chiffre.
 */
export interface WidgetAnalyse {
  plan: ExplorerPlan;
  meta: ExplorerMeta;
  data: ExplorerData;
  /** `cmp=prev`, cartes « Valeur » seulement ; absent ailleurs (W-B2). */
  precedent?: { total: number | null; plage: string; couverture: CouverturePrecedente };
}

/** W-B7 — le trafic : deux populations, deux panneaux, une seule grille de jours. */
export interface WidgetTrafic {
  /** Jours « AAAA-MM-JJ » découpés dans le fuseau de l'app (R-T). */
  grille: string[];
  points: { t: string; pageviews: number | null; errors: number | null }[];
  /** Fuseau de découpe des jours, écrit sur la carte. */
  fuseau: string;
}

/** W-B8 — une route du classement des routes lentes. */
export interface WidgetRoute {
  route: string;
  views: number;
  lcp_p75: number | null;
  inp_p75: number | null;
  cls_p75: number | null;
}

/** W-B8 — le classement, et la référence à laquelle chaque route s'écarte. */
export interface WidgetRoutes {
  lignes: WidgetRoute[];
  /** LCP p75 de l'app entière (`vitalsP75`) : la ligne « Ensemble ». */
  referenceLcp: number | null;
  /** Effectif de la référence, ou `null` si la lecture n'a rien rendu. */
  referenceN: number | null;
  /** Vrai si d'autres routes existent au-delà des huit affichées. */
  tronque: boolean;
}

/** W-B9 — une erreur principale, sa tendance et son statut. */
export interface WidgetErreur {
  fingerprint: string;
  libelle: string;
  occurrences: number;
  sessions: number;
  statut: string;
  /** Occurrences par seau ; `null` = pas assez de points pour une sparkline. */
  serie: number[] | null;
}

export interface WidgetData {
  kind: "value" | "table" | "timeseries" | "toplist" | "invalid" | "error";
  /**
   * Total lu, en NOMBRE (W-B2) : le formatage se fait au rendu, jamais ici. `null`
   * = non calculable, et `raisonNull` dit pourquoi (V3) ; absent = la carte n'a
   * pas de total (journal, table v1).
   */
  total?: number | null;
  /** Effectif de la lecture (lignes de population, mesures). */
  samples?: number;
  /** Jeton de format sérialisable du total (`lib/fmt-ids.ts`). */
  format?: FormatId;
  /** Unité écrite après le total quand le format n'en porte pas (« occurrences »). */
  unit?: string;
  /** R-V : le vital dont le verdict est permis (p75 d'un core vital) ; absent sinon. */
  vital?: VitalName;
  /** R-V : pourquoi cette carte n'a ni badge, ni teinte, ni bande. */
  sansVerdict?: string;
  /** Pourquoi le total est absent — « aucune mesure de LCP sur 24 h » (CE4, V3). */
  raisonNull?: string;
  /** Effectif en toutes lettres, sous la valeur d'une tuile. */
  effectif?: string;
  /** Résultat d'analyse v2, rendu par `ResultatAnalyse`. */
  analyse?: WidgetAnalyse;
  /** Carte v1 « Trafic » (W-B7). */
  trafic?: WidgetTrafic;
  /** Carte v1 « Routes lentes » (W-B8). */
  routes?: WidgetRoutes;
  /** Carte v1 « Erreurs principales » (W-B9). */
  erreurs?: WidgetErreur[];
  sub?: string;
  columns?: string[];
  rows?: (string | number)[][];
  /** Série temporelle : libellés de seaux + une entrée par groupe. */
  series?: { buckets: string[]; groups: WidgetSeriesGroup[]; stacked: boolean };
  ranks?: WidgetRank[];
  /** Fenêtre propre de la carte, quand elle ne suit pas l'écran. */
  rangeLabel?: string;
  /** Filtres portés par la carte, en toutes lettres. */
  filtersLabel?: string;
  /** Ce que la mesure ne dit pas : couverture, troncature, échantillonnage. */
  notes?: string[];
  /** Diagnostic d'une carte illisible ou d'une lecture refusée. */
  reason?: string;
}

const EMPTY: WidgetData = { kind: "table", columns: [], rows: [] };
/** Arrondi d'un percentile pour la projection CSV ; `null` reste `null` (V3). */
const arrondi = (v: unknown): number | null => (v == null ? null : Math.round(Number(v)));
/** Cellule CSV d'une valeur absente : VIDE, jamais « 0 » ni « — » (recette F36). */
const cellVide = (v: number | null): number | string => (v === null ? "" : v);

/** Contexte de rendu d'une grille : filtres de l'écran et fuseau d'affichage. */
export interface WidgetContext {
  filters: Filters;
  timeZone: string;
  nowMs: number;
  /**
   * `cmp` de l'écran (§ 3.1, défaut `none` sur ce domaine). En `prev`, seules les
   * cartes « Valeur » relisent la période précédente (W-B2) : comparer deux
   * classements trompe sur l'ordre, et doubler des courbes les rend illisibles.
   */
  comparaison?: ModeComparaison;
  /** Annulation : une page abandonnée n'ouvre pas les lectures restantes. */
  signal?: AbortSignal;
}

/** « Comparaison demandée, non calculée pour cette forme » — dit, jamais tu (W-B2). */
export const COMPARAISON_HORS_FORME =
  "Comparaison à la période précédente non calculée pour cette forme de carte : seules les cartes « Valeur » la relisent.";

/** Couverture de la période précédente, lue dans la méta de SA propre lecture (§ 3.2). */
function couvertureDeMeta(meta: ExplorerMeta, n: number): CouverturePrecedente {
  if (meta.coverage.status === "complete") return { etat: "complete", raison: null, n };
  return {
    etat: meta.coverage.status === "partial" ? "partielle" : "inconnue",
    raison: meta.coverage.reason ?? "couverture non lue",
    n,
  };
}

// ───────────────────────────── Cache de grille ───────────────────────────────

const cache = new Map<string, { at: number; data: Promise<WidgetData> }>();

function purger(now: number): void {
  for (const [key, entry] of cache) if (now - entry.at >= WIDGET_CACHE_TTL_MS) cache.delete(key);
  // Borne dure : la Map itère dans l'ordre d'insertion, les plus vieilles partent.
  while (cache.size > WIDGET_CACHE_MAX) {
    const premiere = cache.keys().next();
    if (premiere.done) break;
    cache.delete(premiere.value);
  }
}

/** Oublie le cache de grille — pour les tests, et pour une écriture qui vient de changer la donnée. */
export function forgetWidgetCache(): void {
  cache.clear();
}

function memoiser(key: string, now: number, calcul: () => Promise<WidgetData>): Promise<WidgetData> {
  purger(now);
  const connue = cache.get(key);
  if (connue) return connue.data;
  const data = calcul();
  cache.set(key, { at: now, data });
  // Une lecture en échec n'est pas mémorisée : la suivante réessaie.
  data.catch(() => {
    if (cache.get(key)?.data === data) cache.delete(key);
  });
  return data;
}

// ──────────────────────────── Requête d'un widget ────────────────────────────

/**
 * Fenêtre effective d'une carte : la sienne si elle en déclare une, sinon celle
 * de l'écran. Une fenêtre enregistrée devenue invalide (bornes dépassant l'heure
 * du serveur) est un diagnostic, pas un repli silencieux sur une autre fenêtre.
 */
export function widgetRange(
  override: RangeOverride | null,
  ecran: ResolvedRange,
  nowMs: number,
): { ok: true; range: ResolvedRange; own: boolean } | { ok: false; reason: string } {
  if (!override) return { ok: true, range: ecran, own: false };
  const resolved =
    "preset" in override
      ? resolveRange({ period: override.preset }, nowMs)
      : resolveRange({ from: override.from, to: override.to }, nowMs);
  return resolved.ok
    ? { ok: true, range: resolved.value, own: true }
    : { ok: false, reason: `fenêtre propre invalide : ${resolved.error.message}` };
}

/**
 * Requête effective d'une carte analytique : celle de l'écran, INTERSECTÉE avec
 * les filtres de l'AST puis ceux de la carte, sur la fenêtre retenue. Les
 * drapeaux robots / apps internes ne peuvent que rétrécir la population globale.
 */
export function widgetQuery(widget: AnalyticsWidget, ecran: AnalyticsQuery, range: ResolvedRange): AnalyticsQuery {
  const base = intersectQuery(ecran, { conditions: [...widget.conditions, ...widget.filters] });
  return {
    ...base,
    range,
    filters: {
      ...base.filters,
      includeBots: base.filters.includeBots && widget.includeBots,
      includeInternal: base.filters.includeInternal && widget.includeInternal,
    },
  };
}

function libelleSeau(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const nombre = (valeur: number | null): string =>
  valeur === null ? "—" : valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

function libelleCle(key: Array<string | null>): string {
  return key.length ? key.map((valeur) => valeur ?? "Inconnu").join(" · ") : "Population entière";
}

/** Ce que la mesure ne dit pas, repris tel quel de l'enveloppe de l'Explorer. */
function notes(resultat: ExplorerResult, limite: number): string[] {
  const { meta } = resultat;
  const sorties = [...meta.warnings];
  if (meta.coverage.status !== "complete" && meta.coverage.reason) {
    sorties.push(`Résultat partiel : ${meta.coverage.reason}`);
  }
  if (meta.truncated_groups) {
    sorties.push(
      `D’autres combinaisons existent au-delà des ${limite} affichées ; le total porte sur toute la population.`,
    );
  }
  return sorties;
}

/**
 * Représentation d'un résultat analytique (F36). La carte transporte désormais des
 * NOMBRES et le résultat brut : le total, l'effectif, le format et le vital de
 * verdict (R-V) d'un côté, l'objet `analyse` que `ResultatAnalyse` traduira de
 * l'autre. Les projections `ranks` / `series` / `columns` restent, mais pour
 * l'export CSV et l'alternative textuelle seulement — plus pour l'affichage.
 */
function rendre(widget: AnalyticsWidget, resultat: ExplorerResult, timeZone: string): WidgetData {
  const { meta, data } = resultat;
  const plan = widget.plan;
  const vital = vitalDeVerdict(plan);
  const sansVerdict = phraseSansVerdict(plan);
  const commun = {
    notes: notes(resultat, widget.plan.limit),
    total: data.total,
    samples: data.samples,
    format: formatDeMesure(plan),
    unit: meta.unit,
    ...(vital ? { vital } : {}),
    ...(sansVerdict ? { sansVerdict } : {}),
    analyse: { plan, meta, data } as WidgetAnalyse,
  };
  switch (widget.plan.visualization) {
    case "value":
      return { kind: "value", ...commun };
    case "toplist": {
      // Un groupe dont la valeur n'est pas calculable (percentile sans mesure) garde
      // `null` et passe en fin de liste : une barre à 0 se lirait « meilleur groupe »
      // (CE2). L'ordre des autres est celui de l'Explorer.
      const ranks: WidgetRank[] = data.groups.map((groupe) => ({
        label: libelleCle(groupe.key),
        value: groupe.value,
        display: nombre(groupe.value),
        sub: `${groupe.samples.toLocaleString("fr-FR")} lignes`,
      }));
      return {
        kind: "toplist",
        ranks: [...ranks.filter((r) => r.value !== null), ...ranks.filter((r) => r.value === null)],
        ...commun,
      };
    }
    case "timeseries": {
      // Les seaux sont ceux de la fenêtre : un groupe absent d'un seau y vaut
      // zéro pour une mesure ADDITIVE (rien compté = 0), et `null` sinon — un
      // percentile sans mesure n'est pas un percentile nul (CE1). La valeur lue,
      // elle, passe telle quelle : `null` reste `null`.
      const absent = meta.additive ? 0 : null;
      const buckets: string[] = [];
      const index = new Map<string, number>();
      for (const point of data.series) {
        if (!index.has(point.start)) {
          index.set(point.start, buckets.length);
          buckets.push(point.start);
        }
      }
      buckets.sort((a, b) => Date.parse(a) - Date.parse(b));
      buckets.forEach((iso, rang) => index.set(iso, rang));
      const groupes = new Map<string, WidgetSeriesGroup>();
      for (const point of data.series) {
        const rang = index.get(point.start);
        if (rang === undefined) continue; // impossible : chaque début a été indexé ci-dessus
        const cle = libelleCle(point.key);
        const groupe = groupes.get(cle) ?? { label: cle, values: new Array<number | null>(buckets.length).fill(absent) };
        groupe.values[rang] = point.value;
        groupes.set(cle, groupe);
      }
      const groups = [...groupes.values()];
      // On n'EMPILE que ce qui s'additionne : empiler des p95 par navigateur
      // dessinerait une somme qui n'existe pas.
      const stacked = meta.additive && groups.length > 1;
      const sorties = [...commun.notes];
      if (groups.length > 1 && !meta.additive) {
        sorties.push(
          "Mesure non additive : une courbe par groupe, jamais un cumul — empiler des percentiles dessinerait une somme qui n’existe pas.",
        );
      }
      return {
        kind: "timeseries",
        series: { buckets: buckets.map((iso) => libelleSeau(iso, timeZone)), groups, stacked },
        ...commun,
        notes: sorties,
      };
    }
    case "table": {
      const colonnes = Object.keys(data.rows[0] ?? {});
      return {
        kind: "table",
        columns: colonnes,
        rows: data.rows.map((ligne) => colonnes.map((c) => cellule(ligne[c]))),
        ...commun,
      };
    }
  }
}

/** Une cellule de journal : jamais un objet brut, jamais une valeur inventée. */
function cellule(valeur: unknown): string | number {
  if (valeur === null || valeur === undefined) return "—";
  if (valeur instanceof Date) return valeur.toISOString();
  if (typeof valeur === "number") return valeur;
  return String(valeur);
}

/** Texte d'une carte dont la lecture a échoué : le même pour les cartes v1 et v2. */
export const RAISON_LECTURE_INDISPONIBLE = "lecture indisponible — réessayer dans un instant";

/**
 * Résout la donnée d'un widget. `ctx.filters` = filtres effectifs de l'écran
 * (app déjà intersectée avec celle du tableau de bord). Ne jette jamais : une
 * lecture en échec devient une carte de diagnostic, pas une page cassée.
 */
export async function resolveWidget(w: Widget, ctx: WidgetContext): Promise<WidgetData> {
  if (w.kind === "invalid") {
    return {
      kind: "invalid",
      reason: w.reason,
      sub: "Cette carte n’a pas été supprimée : sa configuration est conservée telle quelle.",
    };
  }
  if (w.kind === "v2") return resolveAnalytics(w, ctx);
  return resolveLegacy(w, ctx);
}

async function resolveAnalytics(w: AnalyticsWidget, ctx: WidgetContext): Promise<WidgetData> {
  const ecran = queryOf(ctx.filters);
  const fenetre = widgetRange(w.rangeOverride, ecran.range, ctx.nowMs);
  const filtersLabel = widgetFiltersLabel(w) ?? undefined;
  if (!fenetre.ok) return { kind: "error", reason: fenetre.reason, filtersLabel };
  const query = widgetQuery(w, ecran, fenetre.range);
  const propre = fenetre.own ? rangeLabel(fenetre.range, ctx.timeZone) : undefined;

  const key = `${queryFingerprint(query, "sliding")}:${JSON.stringify([
    w.plan.dataset,
    w.plan.measure,
    w.plan.variant,
    w.plan.groupBy,
    w.plan.visualization,
    w.plan.limit,
  ])}`;
  try {
    const data = await memoiser(key, ctx.nowMs, async () => {
      const resultat = await exploreAnalytics({ query, plan: w.plan });
      return rendre(w, resultat, ctx.timeZone);
    });
    const compare = await comparerSiValeur(w, query, data, ctx);
    return { ...compare, ...(propre ? { rangeLabel: propre } : {}), ...(filtersLabel ? { filtersLabel } : {}) };
  } catch (e) {
    if (e instanceof ExplorerBudgetError) {
      return {
        kind: "error",
        reason: `${e.message}. Aucun chiffre n’est affiché : une série de zéros se lirait comme une absence de trafic.`,
        ...(propre ? { rangeLabel: propre } : {}),
        ...(filtersLabel ? { filtersLabel } : {}),
      };
    }
    if (e instanceof UnsupportedExplorerDimension) {
      return { kind: "error", reason: e.message, ...(filtersLabel ? { filtersLabel } : {}) };
    }
    return { kind: "error", reason: RAISON_LECTURE_INDISPONIBLE };
  }
}

/**
 * W-B2 — `cmp=prev` sur les cartes « Valeur » SEULEMENT. Un second appel relit la
 * même analyse sur la période précédente. Les autres formes ne sont pas comparées
 * et le DISENT : deux classements côte à côte trompent sur l'ordre, et une série
 * doublée cesse d'être lisible. Une lecture de référence en échec ne produit aucun
 * delta : elle rend un total `null` avec sa couverture « inconnue » — jamais un
 * zéro qui se lirait « la période précédente était calme ».
 */
async function comparerSiValeur(
  w: AnalyticsWidget,
  query: AnalyticsQuery,
  data: WidgetData,
  ctx: WidgetContext,
): Promise<WidgetData> {
  if (ctx.comparaison !== "prev" || !data.analyse) return data;
  if (w.plan.visualization !== "value") {
    return { ...data, notes: [...(data.notes ?? []), COMPARAISON_HORS_FORME] };
  }
  const plage = referencePrecedente(query.range);
  const lu = await lire(() =>
    exploreAnalytics({ query: { ...query, range: previousRange(query.range) }, plan: { ...w.plan, cursor: null } }),
  );
  const precedent = lu.ok
    ? { total: lu.data.data.total, plage, couverture: couvertureDeMeta(lu.data.meta, lu.data.data.samples) }
    : {
        total: null,
        plage,
        couverture: { etat: "inconnue", raison: "la lecture de la période précédente a échoué" } as CouverturePrecedente,
      };
  return { ...data, analyse: { ...data.analyse, precedent } };
}

/**
 * Carte v1 (lectures historiques). Une lecture qui LÈVE devient une carte
 * « Mesure indisponible » (`kind: "error"`), journalisée côté serveur par `lire`
 * (F02) — plus une table vide (CE3) : « pas de ligne » et « base indisponible »
 * ne se ressemblent plus. Un filtre que la lecture ne sait pas appliquer est un
 * refus, dit comme tel ; `resolveWidget` ne jette toujours pas.
 */
async function resolveLegacy(w: Extract<Widget, { kind: "v1" }>, ctx: WidgetContext): Promise<WidgetData> {
  try {
    const lecture = await lire(() => lireLegacy(w, ctx));
    return lecture.ok ? lecture.data : { kind: "error", reason: RAISON_LECTURE_INDISPONIBLE };
  } catch (e) {
    if (e instanceof UnsupportedFilterError) return { kind: "error", reason: e.message };
    throw e;
  }
}

/** Statut d'un groupe d'erreurs, en toutes lettres (W-B9). */
const STATUT_ERREUR: Record<string, string> = {
  open: "Ouverte",
  resolved: "Résolue",
  ignored: "Ignorée",
  regressed: "Régressée",
};

/** Sous ce nombre de seaux mesurés, une sparkline ne trace rien de lisible (W-B9). */
const SPARKLINE_MIN_POINTS = 3;

/** Lignes d'une carte v1 à liste : huit — au-delà, une carte cesse d'être lisible. */
const LIGNES_V1 = 8;

async function lireLegacy(w: Extract<Widget, { kind: "v1" }>, ctx: WidgetContext): Promise<WidgetData> {
  const f = ctx.filters;
  switch (w.type) {
    case "vital_p75": {
      // CE4 — trois états distincts, plus un seul « aucune donnée » : aucune mesure
      // (n = 0), percentile non calculable (n > 0, p75 nul), valeur mesurée avec son
      // verdict et son effectif.
      const nom = w.metric ?? "";
      const r = (await vitalsP75(f)).find((x) => x.name === nom);
      const n = r ? Number(r.n) : 0;
      const p75 = r && r.p75 != null ? Number(r.p75) : null;
      const plage = rangeLabel(queryOf(f).range, ctx.timeZone);
      const raisonNull =
        n === 0
          ? `aucune mesure de ${nom || "ce vital"} sur ${plage}`
          : p75 === null
            ? "percentile non calculable"
            : undefined;
      return {
        kind: "value",
        total: p75,
        samples: n,
        format: estVital(nom) ? formatDuVital(nom) : "ms",
        unit: "",
        ...(estVital(nom) ? { vital: nom } : {}),
        ...(raisonNull ? { raisonNull } : {}),
        effectif: `${n.toLocaleString("fr-FR")} mesures`,
      };
    }
    case "traffic": {
      // W-B7 — deux populations (pages vues, occurrences d'erreurs), deux panneaux
      // sur la MÊME grille de jours. La fenêtre est celle de `dailyTraffic`, pas
      // celle de l'écran : 14 jours fixes, découpés dans le fuseau de l'app (R-T).
      const rows = await dailyTraffic(f);
      // `day` arrive en `Date` JS (colonne `date` rendue par node-postgres à minuit
      // local) : `String(d).slice(0, 10)` rendait « Tue Sep 22 ». `cleJour` lit les
      // composantes que le pilote a posées (lib/forecast.ts, F55).
      const jours = rows.map((r) => cleJour(r.day));
      const pv = rows.reduce((s, r) => s + r.pageviews, 0);
      const er = rows.reduce((s, r) => s + r.errors, 0);
      return {
        kind: "timeseries",
        trafic: {
          grille: jours,
          points: rows.map((r, i) => ({ t: jours[i], pageviews: r.pageviews, errors: r.errors })),
          fuseau: ctx.timeZone,
        },
        notes: [
          `14 jours fixes (13 complets + la journée en cours), quelle que soit la plage de l’écran ; jours dans le fuseau de l’app (${ctx.timeZone}).`,
          `${pv.toLocaleString("fr-FR")} pages vues et ${er.toLocaleString("fr-FR")} occurrences d’erreurs sur ces 14 jours — deux populations, jamais additionnées.`,
        ],
        columns: ["Jour", "Pages vues", "Erreurs"],
        rows: rows.map((r, i) => [jours[i], r.pageviews, r.errors]),
      };
    }
    case "slow_routes": {
      // W-B8 — un classement de PERCENTILES : écart au LCP p75 de l'app, jamais une
      // part d'un total (des p75 ne s'additionnent pas).
      const toutes = await slowRoutes(f);
      const lignes = toutes.slice(0, LIGNES_V1);
      const reference = (await vitalsP75(f)).find((x) => x.name === "LCP");
      return {
        kind: "toplist",
        routes: {
          lignes: lignes.map((r) => ({
            route: r.route,
            views: r.views,
            lcp_p75: arrondi(r.lcp_p75),
            inp_p75: arrondi(r.inp_p75),
            cls_p75: r.cls_p75 == null ? null : Number(r.cls_p75),
          })),
          referenceLcp: reference && reference.p75 != null ? Math.round(Number(reference.p75)) : null,
          referenceN: reference ? Number(reference.n) : null,
          tronque: toutes.length > LIGNES_V1,
        },
        columns: ["Route", "Vues", "LCP p75", "INP p75", "CLS p75"],
        // Cellule VIDE pour une absence : « 0 » deviendrait un zéro dans une moyenne
        // de tableur, « — » un texte (recette F36, V3).
        rows: lignes.map((r) => [
          r.route,
          r.views,
          cellVide(arrondi(r.lcp_p75)),
          cellVide(arrondi(r.inp_p75)),
          cellVide(r.cls_p75 == null ? null : Number(r.cls_p75)),
        ]),
      };
    }
    case "top_errors": {
      // Même lecture que l'écran Erreurs, segment, bots et apps internes compris :
      // la conversion vers le modèle v2 perdait ces trois filtres, et la tuile
      // pouvait afficher un autre nombre que la liste qu'elle résume. `series: true`
      // ajoute la tendance de chaque groupe (W-B9) — option jusqu'ici inutilisée.
      const lu = await listErrorGroups(f, { limit: LIGNES_V1, offset: 0 }, { series: true });
      const rows = lu.groups;
      return {
        kind: "table",
        erreurs: rows.map((r) => ({
          fingerprint: r.fingerprint,
          libelle: r.error_type || r.sample_message || r.fingerprint,
          occurrences: r.occurrences,
          sessions: r.sessions,
          statut: STATUT_ERREUR[r.regressed ? "regressed" : r.status] ?? r.status,
          serie: r.series && r.series.filter((v) => v > 0).length >= SPARKLINE_MIN_POINTS ? r.series : null,
        })),
        ...(lu.sampling.message ? { notes: [lu.sampling.message] } : {}),
        columns: ["Erreur", "Occurrences", "Sessions"],
        rows: rows.map((r) => [
          r.error_type || r.sample_message || r.fingerprint,
          r.occurrences,
          r.sessions,
        ]),
      };
    }
    case "frustration": {
      // La cible est un texte long : un classement en barres la tronquerait. La table
      // reste la forme juste (W-B10).
      const rows = (await topFrustrations(f)).slice(0, LIGNES_V1);
      return {
        kind: "table",
        columns: ["Type", "Cible", "Route", "Occurrences"],
        rows: rows.map((r) => [r.kind, r.target, r.route, r.n]),
      };
    }
    case "event_count": {
      if (!w.eventName) {
        return { kind: "value", total: null, format: "count", unit: "", raisonNull: "nom d’événement manquant" };
      }
      const result = await eventCount(f, w.eventName);
      if (!result.available || result.count == null) {
        // « Non collecté » : une capacité absente n'est pas un zéro (V3, § 0.5).
        return {
          kind: "value",
          total: null,
          format: "count",
          unit: "",
          raisonNull: result.available ? (result.diagnostic ?? "donnée indisponible") : "Non collecté",
          ...(result.diagnostic ? { effectif: result.diagnostic } : {}),
        };
      }
      return {
        kind: "value",
        total: result.count,
        samples: result.count,
        format: "count",
        unit: "",
        effectif: result.sampling_notice?.message ?? `événements « ${w.eventName} » observés`,
      };
    }
    default:
      // Type inconnu (normalizeLayout ne le laisse pas passer) : une carte illisible,
      // pas une table vide qu'on lirait comme « aucune ligne ».
      return { kind: "invalid", reason: "type de carte inconnu" };
  }
}

/**
 * Résout une grille entière, par vagues de `WIDGET_CONCURRENCY`. L'ordre de
 * sortie est celui de la grille, quel que soit l'ordre d'arrivée des lectures.
 * Une annulation laisse les cartes restantes dans un état explicite, jamais dans
 * un chiffre faux.
 */
export async function resolveWidgets(widgets: Widget[], ctx: WidgetContext): Promise<WidgetData[]> {
  const out = new Array<WidgetData>(widgets.length);
  let prochain = 0;
  const travailleur = async (): Promise<void> => {
    for (;;) {
      const index = prochain++;
      if (index >= widgets.length) return;
      if (ctx.signal?.aborted) {
        out[index] = { kind: "error", reason: "lecture annulée : la page a été quittée avant la réponse" };
        continue;
      }
      out[index] = await resolveWidget(widgets[index], ctx);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WIDGET_CONCURRENCY, Math.max(widgets.length, 1)) }, travailleur),
  );
  return out;
}

// ────────────────────────────────── Export ───────────────────────────────────

/** Plafond d'un export : au-delà, la troncature est ANNONCÉE, jamais silencieuse. */
export const CSV_MAX_ROWS = 10_000;

/**
 * Échappement CSV. Deux protections distinctes :
 *   · RFC 4180 : guillemets, virgules, points-virgules et sauts de ligne ;
 *   · injection de formule : une cellule commençant par `=`, `+`, `-` ou `@` est
 *     exécutée par les tableurs. Elle est préfixée d'une apostrophe — la valeur
 *     reste lisible, elle ne devient pas une instruction.
 */
export function csvCell(v: string | number): string {
  const brut = String(v ?? "");
  const sur = /^[=+\-@]/.test(brut) ? `'${brut}` : brut;
  return /[",\n;]/.test(sur) ? `"${sur.replace(/"/g, '""')}"` : sur;
}

/**
 * Sérialise une carte en lignes CSV, sous le plafond RESTANT. `truncated` dit que
 * des lignes ont été laissées de côté : l'appelant l'annonce en tête de fichier.
 */
export function widgetToCsv(
  title: string,
  d: WidgetData,
  budget: number,
): { csv: string; used: number; truncated: boolean } {
  const lines: string[] = [`# ${csvCell(title)}`];
  if (d.reason) lines.push(csvCell(`diagnostic : ${d.reason}`));
  if (d.rangeLabel) lines.push(csvCell(d.rangeLabel));
  if (d.filtersLabel) lines.push(csvCell(`filtres : ${d.filtersLabel}`));
  for (const note of d.notes ?? []) lines.push(csvCell(note));
  if (d.sansVerdict) lines.push(csvCell(d.sansVerdict));
  // Le total part en NOMBRE, sur sa propre ligne d'en-tête (F36) : une chaîne
  // formatée en français (« 2,7 s ») n'est pas un nombre pour un tableur. Une
  // absence est une cellule VIDE, jamais « 0 » ni « — » (V3, recette F36) ; sa
  // raison est écrite à côté, pour qu'elle ne se lise pas comme un silence.
  if (d.total !== undefined) {
    lines.push(["Valeur", "Effectif", "Raison de l’absence"].map(csvCell).join(","));
    lines.push([cellVide(d.total), d.samples === undefined ? "" : d.samples, d.raisonNull ?? ""].map(csvCell).join(","));
  }

  let used = 0;
  let truncated = false;
  const pousser = (cells: (string | number)[]): boolean => {
    if (used >= budget) {
      truncated = true;
      return false;
    }
    lines.push(cells.map(csvCell).join(","));
    used += 1;
    return true;
  };

  if (d.ranks?.length) {
    lines.push(["Groupe", "Valeur", "Lignes"].map(csvCell).join(","));
    // Valeur non calculable pour ce groupe : cellule VIDE, jamais « 0 » (CE2, V3).
    for (const rang of d.ranks) if (!pousser([rang.label, cellVide(rang.value), rang.sub ?? ""])) break;
  } else if (d.series) {
    lines.push(["Seau", ...d.series.groups.map((g) => g.label)].map(csvCell).join(","));
    for (const [i, seau] of d.series.buckets.entries()) {
      // Seau sans mesure : cellule VIDE, jamais « 0 » — un tableur en ferait un zéro
      // dans une moyenne (CE1).
      if (!pousser([seau, ...d.series.groups.map((g) => g.values[i] ?? "")])) break;
    }
  } else if (d.columns?.length) {
    lines.push(d.columns.map(csvCell).join(","));
    for (const row of d.rows ?? []) if (!pousser(row)) break;
  }
  return { csv: lines.join("\n"), used, truncated };
}

/**
 * Export complet d'une grille : une section par carte, sous un plafond GLOBAL de
 * 10 000 lignes. La troncature est écrite dans le fichier — un tableur ouvert sur
 * un export tronqué ne doit pas passer pour l'inventaire complet.
 */
export function layoutToCsv(name: string, widgets: Widget[], data: WidgetData[], generatedAt: Date): string {
  const blocks: string[] = [];
  let budget = CSV_MAX_ROWS;
  let tronque = false;
  for (const [i, widget] of widgets.entries()) {
    const bloc = widgetToCsv(widget.title, data[i] ?? EMPTY, budget);
    budget -= bloc.used;
    blocks.push(bloc.csv);
    tronque ||= bloc.truncated;
    if (budget <= 0) {
      tronque ||= i < widgets.length - 1;
      break;
    }
  }
  const entete = [`# Tableau de bord : ${csvCell(name)} (export ${generatedAt.toISOString()})`];
  if (tronque) {
    entete.push(
      `# ${csvCell(
        `Export tronqué au plafond de ${CSV_MAX_ROWS} lignes : des lignes, voire des cartes entières, manquent.`,
      )}`,
    );
  }
  return [entete.join("\n"), ...blocks].join("\n\n");
}
