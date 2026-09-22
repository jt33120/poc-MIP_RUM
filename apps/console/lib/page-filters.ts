// Filtres d'un écran de la console (P6.2) : une seule entrée pour toutes les pages.
//
// Le périmètre vient du principal SIGNÉ (liste vide = aucun accès), la plage et les
// filtres du contrat commun, puis l'écran vérifie qu'il sait appliquer TOUT ce que
// l'URL demande (lib/surfaces.ts). Un écran de MESURES qui ne sait pas appliquer un
// filtre le refuse — message et lien de reprise —, jamais un chiffre calculé en
// ignorant une partie de l'URL. Un écran de CONFIGURATION (SLO, règles, liste des
// tableaux de bord) n'a pas de population à filtrer : il s'affiche, et dit que les
// filtres portés par l'URL ne s'y appliquent pas.
import { getUser } from "./auth";
import { deviceFiltersOfQuery, filtersOfQuery, type Filters, type FiltersLike, type SearchParams } from "./filters";
import { fuseauDe } from "./fuseau";
import {
  bucketLabel,
  conditionsOf,
  paramReader,
  parseAnalyticsQuery,
  rangeLabel,
  requestedAppOf,
  type AnalyticsQuery,
  type ContractErrorCode,
} from "./query-contract";
import { dimensionSchema } from "./query-schema";
import { checkSurface, perimetreAvailability, surfaceFor, type Surface } from "./surfaces";

export interface FilterProblem {
  code: ContractErrorCode;
  message: string;
  /** Reprise : le même écran et la même app, filtres retirés ; `/select` sans accès. */
  resetHref: string;
  resetLabel: string;
}

export type PageFilters =
  | {
      ok: true;
      filters: Filters;
      /** Façade P4/P5 : tablette comprise. */
      deviceFilters: FiltersLike;
      query: AnalyticsQuery;
      /** « 24 h », ou « du 17/09 10:00 au 17/09 12:00 » dans le fuseau de l'app. */
      label: string;
      bucketLabel: string;
      /** Écran de configuration : pourquoi les filtres de l'URL ne s'y appliquent pas. */
      notApplied: string | null;
    }
  | { ok: false; problem: FilterProblem };

function problemOf(pathname: string, app: string | null, code: ContractErrorCode, message: string): FilterProblem {
  if (code === "no_app_access" || code === "forbidden_app") {
    return { code, message, resetHref: "/select", resetLabel: "Choisir un projet autorisé" };
  }
  const qs = app ? `?app=${encodeURIComponent(app)}` : "";
  return { code, message, resetHref: `${pathname}${qs}`, resetLabel: "Réinitialiser les filtres" };
}

/** Raison affichée quand un écran sans population reçoit des filtres ou une plage personnalisée. */
function notAppliedOn(surface: Surface, query: AnalyticsQuery): string | null {
  const reasons = new Set<string>();
  if (surface.noFilters && conditionsOf(query.filters).length > 0) reasons.add(surface.noFilters);
  if (query.range.preset === null && surface.range === "none") {
    reasons.add(surface.rangeNote ?? surface.noFilters ?? "La plage ne s'applique pas à cet écran.");
  }
  return reasons.size ? [...reasons].join(" ") : null;
}

export async function pageFilters(sp: SearchParams | undefined, pathname: string): Promise<PageFilters> {
  const surface = surfaceFor(pathname);
  // Un écran branché sur le contrat déclare ses capacités : sans elles, rien ne
  // garantirait qu'il applique ce que l'URL demande.
  if (!surface) throw new Error(`écran sans capacités de filtrage déclarées : ${pathname}`);
  const user = await getUser();
  const reader = paramReader(sp ?? {});
  const app = requestedAppOf(reader.get("app"));
  const parsed = parseAnalyticsQuery(reader, { principal: user, nowMs: Date.now() });
  if (!parsed.ok) return { ok: false, problem: problemOf(pathname, app, parsed.error.code, parsed.error.message) };
  const query = parsed.value;
  // Périmètre AVANT les filtres : une lecture mono-app sous `app=all` sortirait du
  // périmètre d'un principal restreint (R-A). Refus de périmètre, donc reprise vers
  // le choix d'un projet — pas « réinitialiser les filtres », qui garderait `all`.
  const perimetre = perimetreAvailability(surface, query.scope);
  if (!perimetre.available) return { ok: false, problem: problemOf(pathname, app, "forbidden_app", perimetre.reason) };
  if (!surface.noFilters) {
    const check = checkSurface(query, surface, await dimensionSchema());
    if (!check.ok) return { ok: false, problem: problemOf(pathname, app, check.error.code, check.error.message) };
  }
  return {
    ok: true,
    filters: filtersOfQuery(query),
    deviceFilters: deviceFiltersOfQuery(query),
    query,
    label: rangeLabel(query.range, await fuseauDe(query.scope.requestedApp)),
    bucketLabel: bucketLabel(query.range.bucketSeconds),
    notApplied: notAppliedOn(surface, query),
  };
}
