// GET /api/v1/errors — groupes d'erreurs (par app + fingerprint) sur la fenêtre, avec
// les totaux de la population, la tendance, l'avertissement d'échantillonnage et les
// occurrences non groupables. Même lecture que l'écran /errors (lib/queries-errors.ts) :
// l'API ne peut plus afficher un autre nombre que la console sur le même périmètre.
import { handle } from "@/lib/api/handle";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import {
  errorDeviceFrom,
  errorScopeFor,
  listErrorGroups,
  parseErrorListPage,
  type ErrorFilters,
} from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal, filters, searchParams }) => {
  // AD-16 : une session viewer SANS app n'a accès à rien. `parseApiFilters` la
  // traiterait comme non restreinte (liste vide = pas de clamp) et ouvrirait toutes
  // les apps : le refus doit précéder toute lecture.
  if (errorScopeFor({ role: principal.role, apps: principal.apps }).kind === "none")
    throw new ApiHttpError(403, "aucune application autorisée");
  // Filtres `legacy` (segment, bots et apps internes exclus comme la console) +
  // tablette. Jamais `filters.v2.device` : il vaut 'all' quand le paramètre est absent,
  // et un appareil nommé 'all' ne correspond à aucune session.
  const f: ErrorFilters = { ...filters.legacy, device: errorDeviceFrom(filters.device) };
  const result = await listErrorGroups(f, parseErrorListPage(searchParams));
  // Clés historiques d'abord, puis les ajouts P5.1 — énumérées plutôt que
  // recopiées en bloc : un champ ajouté à la lecture n'apparaît pas dans le contrat
  // public sans passer par ici (et par la spec OpenAPI).
  return {
    groups: result.groups,
    unfingerprinted: result.unfingerprinted,
    page: result.page,
    total: result.total,
    totals: result.totals,
    trend: result.trend,
    sampling: result.sampling,
    enrichment: result.enrichment,
  };
});
