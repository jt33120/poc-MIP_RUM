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
import { fmtVital } from "./format";
import { dailyTraffic } from "./queries-grid";
import { topFrustrations } from "./queries-frustration";
import { listErrorGroups } from "./queries-errors";
import { slowRoutes, vitalsP75 } from "./queries";
import { eventCount } from "./queries-events";
import { ExplorerBudgetError, UnsupportedExplorerDimension } from "./analytics-schema";
import { exploreAnalytics, type ExplorerResult } from "./queries-explorer";
import {
  intersectQuery,
  queryFingerprint,
  rangeLabel,
  resolveRange,
  type AnalyticsQuery,
  type ResolvedRange,
} from "./query-contract";

/** Une carte au plus toutes les quatre : le pool de la console en compte dix. */
export const WIDGET_CONCURRENCY = 4;
/** Mémoire du cache de grille. Assez pour l'affichage puis son export, pas plus. */
export const WIDGET_CACHE_TTL_MS = 10_000;
const WIDGET_CACHE_MAX = 200;

export interface WidgetSeriesGroup {
  label: string;
  /** Une valeur par seau, dans l'ordre de `buckets`. */
  values: number[];
}

export interface WidgetRank {
  label: string;
  value: number;
  display: string;
  sub?: string;
}

export interface WidgetData {
  kind: "value" | "table" | "timeseries" | "toplist" | "invalid" | "error";
  value?: string; // résumé (kind 'value' ou en-tête de table)
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
const num = (v: unknown) => (v == null ? "—" : Math.round(Number(v)));

/** Contexte de rendu d'une grille : filtres de l'écran et fuseau d'affichage. */
export interface WidgetContext {
  filters: Filters;
  timeZone: string;
  nowMs: number;
  /** Annulation : une page abandonnée n'ouvre pas les lectures restantes. */
  signal?: AbortSignal;
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

/** Représentation d'un résultat analytique, selon la visualisation enregistrée. */
function rendre(widget: AnalyticsWidget, resultat: ExplorerResult, timeZone: string): WidgetData {
  const { meta, data } = resultat;
  const commun = { notes: notes(resultat, widget.plan.limit) };
  switch (widget.plan.visualization) {
    case "value":
      return {
        kind: "value",
        value: nombre(data.total),
        sub: `${meta.unit} · ${data.samples.toLocaleString("fr-FR")} lignes`,
        ...commun,
      };
    case "toplist":
      return {
        kind: "toplist",
        value: `${nombre(data.total)} ${meta.unit}`,
        ranks: data.groups.map((groupe) => ({
          label: libelleCle(groupe.key),
          value: groupe.value ?? 0,
          display: nombre(groupe.value),
          sub: `${groupe.samples.toLocaleString("fr-FR")} lignes`,
        })),
        ...commun,
      };
    case "timeseries": {
      // Les seaux sont ceux de la fenêtre : un groupe absent d'un seau y vaut
      // zéro pour une mesure additive, et null (donc aucun point) sinon.
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
        const cle = libelleCle(point.key);
        const groupe = groupes.get(cle) ?? { label: cle, values: new Array(buckets.length).fill(0) };
        groupe.values[index.get(point.start) ?? 0] = point.value ?? 0;
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
        value: `${nombre(data.total)} ${meta.unit}`,
        series: { buckets: buckets.map((iso) => libelleSeau(iso, timeZone)), groups, stacked },
        notes: sorties,
      };
    }
    case "table": {
      const colonnes = Object.keys(data.rows[0] ?? {});
      return {
        kind: "table",
        value: `${nombre(data.total)} ${meta.unit}`,
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
  return resolveLegacy(w, ctx.filters);
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
    return { ...data, ...(propre ? { rangeLabel: propre } : {}), ...(filtersLabel ? { filtersLabel } : {}) };
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
    return { kind: "error", reason: "lecture indisponible — réessayer dans un instant" };
  }
}

async function resolveLegacy(w: Extract<Widget, { kind: "v1" }>, f: Filters): Promise<WidgetData> {
  try {
    switch (w.type) {
      case "vital_p75": {
        const r = (await vitalsP75(f)).find((x) => x.name === w.metric);
        return r && r.p75 != null
          ? { kind: "value", value: fmtVital(w.metric ?? "", Number(r.p75)), sub: `${r.n} mesures` }
          : { kind: "value", value: "—", sub: "aucune donnée" };
      }
      case "traffic": {
        const rows = await dailyTraffic(f);
        const pv = rows.reduce((s, r) => s + r.pageviews, 0);
        const er = rows.reduce((s, r) => s + r.errors, 0);
        return {
          kind: "table",
          value: `${pv.toLocaleString("fr-FR")} vues · ${er.toLocaleString("fr-FR")} erreurs`,
          columns: ["Jour", "Pages vues", "Erreurs"],
          rows: rows.map((r) => [String(r.day).slice(0, 10), r.pageviews, r.errors]),
        };
      }
      case "slow_routes": {
        const rows = (await slowRoutes(f)).slice(0, 8);
        return {
          kind: "table",
          columns: ["Route", "Vues", "LCP p75", "INP p75"],
          rows: rows.map((r) => [r.route, r.views, num(r.lcp_p75), num(r.inp_p75)]),
        };
      }
      case "top_errors": {
        // Même lecture que l'écran Erreurs, segment, bots et apps internes compris :
        // la conversion vers le modèle v2 perdait ces trois filtres, et la tuile
        // pouvait afficher un autre nombre que la liste qu'elle résume.
        const { groups: rows } = await listErrorGroups(f, { limit: 8, offset: 0 });
        return {
          kind: "table",
          columns: ["Erreur", "Occurrences", "Sessions"],
          rows: rows.map((r) => [
            r.error_type || r.sample_message || r.fingerprint,
            r.occurrences,
            r.sessions,
          ]),
        };
      }
      case "frustration": {
        const rows = (await topFrustrations(f)).slice(0, 8);
        return {
          kind: "table",
          columns: ["Type", "Cible", "Route", "Occurrences"],
          rows: rows.map((r) => [r.kind, r.target, r.route, r.n]),
        };
      }
      case "event_count": {
        if (!w.eventName) return { kind: "value", value: "—", sub: "nom d’événement manquant" };
        const result = await eventCount(f, w.eventName);
        if (!result.available || result.count == null) {
          return { kind: "value", value: "—", sub: result.diagnostic ?? "donnée indisponible" };
        }
        return {
          kind: "value",
          value: result.count.toLocaleString("fr-FR"),
          sub: result.sampling_notice?.message ?? `événements « ${w.eventName} » observés`,
        };
      }
      default:
        return EMPTY;
    }
  } catch {
    return EMPTY;
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
  if (d.value) lines.push(csvCell(d.value));

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
    for (const rang of d.ranks) if (!pousser([rang.label, rang.display, rang.sub ?? ""])) break;
  } else if (d.series) {
    lines.push(["Seau", ...d.series.groups.map((g) => g.label)].map(csvCell).join(","));
    for (const [i, seau] of d.series.buckets.entries()) {
      if (!pousser([seau, ...d.series.groups.map((g) => g.values[i] ?? 0)])) break;
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
