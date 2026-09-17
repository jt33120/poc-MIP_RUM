// GET /api/v1/errors/{fingerprint} — détail d'un groupe d'erreurs : groupe (impact),
// tendance, dernier exemplaire et occurrences paginées par curseur, avec leurs liens
// vérifiés dans la même app. Même base filtrée que la liste : ouvrir un groupe donne
// le nombre qu'on vient de lire.
//
// UNE EMPREINTE N'IDENTIFIE PAS UN GROUPE. Deux apps peuvent la partager ; l'ancienne
// lecture en retenait une arbitraire (`limit 1`). Sans `app`, la route cherche dans
// tout le périmètre du principal et refuse (400, apps candidates listées) plutôt que
// de choisir à la place du client.
import { handle } from "@/lib/api/handle";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import {
  errorDeviceFrom,
  errorGroupDetail,
  errorScopeFor,
  isFingerprintParam,
  parseErrorCursor,
  parseOccurrencesPage,
  resolveErrorGroup,
  scopeApps,
  type ErrorFilters,
} from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const INTROUVABLE = "groupe d'erreurs introuvable";

export const GET = handle(async ({ principal, filters, searchParams, params }) => {
  // AD-16 : sans aucune app autorisée, le groupe n'existe pas pour ce principal —
  // 404 comme une ressource hors périmètre, sans interroger la base.
  const scope = errorScopeFor({ role: principal.role, apps: principal.apps });
  if (scope.kind === "none") throw new ApiHttpError(404, INTROUVABLE);

  const fingerprint = params.fingerprint ?? "";
  if (!isFingerprintParam(fingerprint)) throw new ApiHttpError(400, "fingerprint invalide");
  const cursor = parseErrorCursor(searchParams.get("cursor"));
  if (cursor === undefined) throw new ApiHttpError(400, "cursor invalide");
  const { limit } = parseOccurrencesPage(searchParams);

  // Voir la liste : `legacy` + tablette, jamais `filters.v2.device`.
  const f: ErrorFilters = { ...filters.legacy, device: errorDeviceFrom(filters.device) };
  const requested = searchParams.get("app");
  const resolution =
    requested && requested !== "all"
      ? // App nommée : déjà ramenée au périmètre par parseApiFilters (même rabattage
        // silencieux que les autres routes, signalé par `meta.app`).
        await resolveErrorGroup(fingerprint, f, null)
      : // Sans app, `filters.legacy.app` vaut la PREMIÈRE app d'un principal scopé :
        // chercher là seulement masquerait une empreinte présente dans une autre de
        // ses apps. La recherche couvre donc tout son périmètre, et lui seul.
        await resolveErrorGroup(fingerprint, { ...f, app: null }, scopeApps(scope));

  if (resolution.kind === "not_found") throw new ApiHttpError(404, INTROUVABLE);
  if (resolution.kind === "ambiguous")
    throw new ApiHttpError(
      400,
      `fingerprint présent dans plusieurs apps : préciser app (${resolution.candidates.map((c) => c.app_id).join(", ")})`,
    );

  const { ref } = resolution;
  const detail = await errorGroupDetail(ref, { ...f, app: ref.app_id }, { limit, cursor });
  if (!detail) throw new ApiHttpError(404, INTROUVABLE);
  // `meta.app` annonce l'app dont viennent les chiffres. Sans app demandée, ce serait
  // sinon « all » ou la première app du scope, alors que le groupe résolu peut en être
  // une autre — une réponse qui contredit sa propre enveloppe. `handle` construit
  // `meta` après ce retour, à partir de cet objet.
  filters.app = ref.app_id;
  return {
    group: detail.group,
    last: detail.last,
    occurrences: detail.occurrences,
    trend: detail.trend,
    page: detail.page,
    sampling: detail.sampling,
    enrichment: detail.enrichment,
  };
});
