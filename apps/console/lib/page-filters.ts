// Filtres d'un écran de la console (P6.2) : une seule entrée pour toutes les pages.
//
// Le périmètre vient du principal SIGNÉ (liste vide = aucun accès), la plage et les
// filtres du contrat commun, puis l'écran vérifie qu'il sait appliquer TOUT ce que
// l'URL demande (lib/surfaces.ts). Un refus rend un problème récupérable — message
// et lien de reprise — jamais un chiffre calculé en ignorant une partie de l'URL.
import { getUser } from "./auth";
import { deviceFiltersOfQuery, filtersOfQuery, type Filters, type FiltersLike, type SearchParams } from "./filters";
import { fuseauDe } from "./fuseau";
import {
  bucketLabel,
  paramReader,
  parseAnalyticsQuery,
  rangeLabel,
  requestedAppOf,
  type AnalyticsQuery,
  type ContractErrorCode,
} from "./query-contract";
import { dimensionSchema } from "./query-schema";
import { checkSurface, surfaceFor } from "./surfaces";

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
    }
  | { ok: false; problem: FilterProblem };

function problemOf(pathname: string, app: string | null, code: ContractErrorCode, message: string): FilterProblem {
  if (code === "no_app_access" || code === "forbidden_app") {
    return { code, message, resetHref: "/select", resetLabel: "Choisir un projet autorisé" };
  }
  const qs = app ? `?app=${encodeURIComponent(app)}` : "";
  return { code, message, resetHref: `${pathname}${qs}`, resetLabel: "Réinitialiser les filtres" };
}

export async function pageFilters(sp: SearchParams, pathname: string): Promise<PageFilters> {
  const user = await getUser();
  const reader = paramReader(sp);
  const app = requestedAppOf(reader.get("app"));
  const parsed = parseAnalyticsQuery(reader, { principal: user, nowMs: Date.now(), mode: "compat" });
  if (!parsed.ok) return { ok: false, problem: problemOf(pathname, app, parsed.error.code, parsed.error.message) };
  const query = parsed.value;
  const surface = surfaceFor(pathname);
  if (surface) {
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
  };
}
