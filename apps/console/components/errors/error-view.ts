// Liens, libellés et données de graphique des écrans Erreurs (P5.1). Logique pure :
// aucune lecture, testée par tests/unit/errors-view.test.ts.
import type { StackSeries } from "@/components/charts/StackedBars";
import type { IssueListFilters } from "@/lib/error-issues";
import { queryOf, type SearchParams } from "@/lib/filters";
import type {
  ErrorFilters,
  ErrorGroupRef,
  ErrorGroupRow,
  ErrorOccurrenceRow,
  ErrorTrendPoint,
} from "@/lib/queries-errors";
import { queryToSearchParams } from "@/lib/query-contract";

/** Next livre un paramètre répété en tableau : on retient le premier, comme parseFilters. */
export function errorSearchParams(sp: SearchParams): URLSearchParams {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) url.set(key, v);
  }
  return url;
}

/**
 * URL d'un écran Erreurs portant les filtres actifs, sous leur forme canonique du
 * contrat commun : plage (preset ou from/to), appareil, dimensions, segment v2,
 * bots, apps internes. L'app est TOUJOURS explicite — « all » quand aucune : sans
 * elle, la porte projet du middleware substituerait l'app du cookie et le lien
 * ouvrirait un autre périmètre que celui qu'on lisait. Curseur et limite ne
 * suivent jamais : ils n'ont de sens que pour la liste qui les a produits.
 */
export function errorsHref(
  path: string,
  f: ErrorFilters,
  app: string | null,
  extra: Record<string, string> = {},
): string {
  const p = queryToSearchParams(queryOf(f));
  p.set("app", app ?? "all");
  for (const [key, value] of Object.entries(extra)) p.set(key, value);
  return `${path}?${p}`;
}

/** Le détail d'un groupe, dans SON app : une empreinte seule peut en désigner plusieurs. */
export function errorGroupHref(ref: ErrorGroupRef, f: ErrorFilters, extra?: Record<string, string>): string {
  return errorsHref(`/errors/${encodeURIComponent(ref.fingerprint)}`, f, ref.app_id, extra);
}

/** Le détail d'une issue (P5.5), dans son app, avec les filtres actifs. */
export function issueHref(ref: { id: string; app_id: string }, f: ErrorFilters, extra?: Record<string, string>): string {
  return errorsHref(`/errors/issues/${encodeURIComponent(ref.id)}`, f, ref.app_id, extra);
}

/**
 * La liste des issues avec ses filtres d'entrée et d'occurrence (statut, source,
 * release) : ils suivent la pagination, jamais le curseur un changement de filtre.
 */
export function issueListHref(f: ErrorFilters, filtres: IssueListFilters, extra: Record<string, string> = {}): string {
  return errorsHref("/errors", f, f.app, {
    ...(filtres.status ? { status: filtres.status } : {}),
    ...(filtres.source ? { source: filtres.source } : {}),
    ...(filtres.release ? { release: filtres.release } : {}),
    ...extra,
  });
}

export interface OccurrenceHrefs {
  session: string | null;
  replay: string | null;
  trace: string | null;
}

/**
 * Liens d'une occurrence, seulement vers ce qui existe DANS SON APP (relations
 * vérifiées par la lecture). Chaque destination reçoit l'app et la revérifie :
 * les identifiants de session et de trace sont émis par le client.
 */
export function occurrenceHrefs(appId: string, o: ErrorOccurrenceRow): OccurrenceHrefs {
  const app = encodeURIComponent(appId);
  const session =
    o.links.session && o.session_id ? `/sessions/${encodeURIComponent(o.session_id)}?app=${app}` : null;
  // L'instant de l'erreur, en epoch ms : le lecteur s'y positionne s'il est enregistré.
  const replay = o.links.replay && session ? `${session}&tab=replay&at=${o.ts.getTime()}` : null;
  const span = o.links.parent_span && o.source_parent_span_id ? `&span=${o.source_parent_span_id}` : "";
  const trace =
    o.links.trace && o.trace_id ? `/tracing/${encodeURIComponent(o.trace_id)}?app=${app}${span}` : null;
  return { session, replay, trace };
}

/** Un compteur de personnes ou de sessions : NULL veut dire inconnu, jamais zéro. */
export function fmtCount(v: number | null): string {
  return v === null ? "Inconnu" : v.toLocaleString("fr-FR");
}

/** Une couverture 0..1 : NULL (aucune occurrence) veut dire inconnue. */
export function fmtCoverage(v: number | null): string {
  return v === null ? "Inconnue" : `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/** Libellé d'un seau : dès 6 h de largeur l'heure seule est ambiguë, on date le seau. */
export function bucketTick(bucket: Date, bucketSeconds: number): string {
  return bucketSeconds >= 21_600
    ? bucket.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit" })
    : bucket.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

const PALETTE = ["#ef4444", "#f89101", "#d97706", "#7c3aed", "#2563eb"];
const TOP_N = 5;

/**
 * Volume par seau, empilé par groupe dominant de la page. « autres » est la
 * population MOINS les groupes dessinés, pas la somme des groupes restants de la
 * page : la tendance couvre aussi les groupes des pages suivantes, et le total
 * d'une colonne reste celui de la tendance. Borné à 0 par prudence : un empilement
 * ne dessine jamais une quantité négative.
 */
export function errorVolumeChart(
  groups: Pick<ErrorGroupRow, "error_type" | "series">[],
  trend: ErrorTrendPoint[],
  bucketSeconds: number,
): { data: Record<string, number | string>[]; series: StackSeries[] } {
  const top = groups.slice(0, TOP_N);
  const data = trend.map((point, i) => {
    const row: Record<string, number | string> = { h: bucketTick(point.bucket, bucketSeconds) };
    let dessine = 0;
    top.forEach((g, gi) => {
      const v = g.series?.[i] ?? 0;
      row[`g${gi}`] = v;
      dessine += v;
    });
    row.autres = Math.max(0, point.occurrences - dessine);
    return row;
  });
  const series: StackSeries[] = top.map((g, gi) => ({
    key: `g${gi}`,
    name: (g.error_type ?? "Error").slice(0, 22),
    color: PALETTE[gi],
  }));
  if (data.some((row) => Number(row.autres) > 0)) series.push({ key: "autres", name: "autres", color: "#94a3b8" });
  return { data, series };
}
