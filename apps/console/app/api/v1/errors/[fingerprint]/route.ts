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
import { announceResourceApp } from "@/lib/api/params";
import { ApiHttpError, preflight } from "@/lib/api/respond";
import { exemplarSymbolication } from "@/lib/error-symbolication";
import {
  errorDeviceFrom,
  errorGroupDetail,
  isFingerprintParam,
  parseErrorCursor,
  parseOccurrencesPage,
  resolveErrorGroup,
  type ErrorFilters,
} from "@/lib/queries-errors";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const INTROUVABLE = "groupe d'erreurs introuvable";

export const GET = handle(async ({ filters, searchParams, params }) => {
  // Périmètre déjà résolu par `handle` (AD-16) : aucune app autorisée ou app nommée
  // hors périmètre sont refusées (403) avant toute lecture.
  const fingerprint = params.fingerprint ?? "";
  if (!isFingerprintParam(fingerprint)) throw new ApiHttpError(400, "fingerprint invalide");
  const cursor = parseErrorCursor(searchParams.get("cursor"));
  if (cursor === undefined) throw new ApiHttpError(400, "cursor invalide");
  const { limit } = parseOccurrencesPage(searchParams);

  // Voir la liste : `legacy` + tablette, jamais `filters.v2.device`.
  const f: ErrorFilters = { ...filters.legacy, device: errorDeviceFrom(filters.device) };
  const resolution =
    f.app !== null
      ? // App nommée, autorisée : la résolution se limite à elle.
        await resolveErrorGroup(fingerprint, f, null)
      : // Sans app : tout le périmètre AUTORISÉ du principal, et lui seul — une
        // empreinte présente dans deux de ses apps est refusée plus bas (400).
        await resolveErrorGroup(fingerprint, f, filters.query.scope.authorizedApps);

  if (resolution.kind === "not_found") throw new ApiHttpError(404, INTROUVABLE);
  if (resolution.kind === "ambiguous")
    throw new ApiHttpError(
      400,
      `fingerprint présent dans plusieurs apps : préciser app (${resolution.candidates.map((c) => c.app_id).join(", ")})`,
    );

  const { ref } = resolution;
  const detail = await errorGroupDetail(ref, { ...f, app: ref.app_id }, { limit, cursor });
  if (!detail) throw new ApiHttpError(404, INTROUVABLE);
  // `meta.app` et `meta.scope` annoncent l'app dont viennent les chiffres. Sans app
  // demandée, ce serait sinon « all », alors que le groupe résolu est dans UNE app —
  // une réponse qui contredirait sa propre enveloppe. `handle` construit `meta`
  // après ce retour, à partir de cet objet.
  announceResourceApp(filters, ref.app_id);
  // Stack source (P5.4) : celle de l'ingestion, sinon symbolisée à la lecture si
  // une map est arrivée depuis. Champs ajoutés, `stack` reste la stack brute.
  const symbolication = await exemplarSymbolication(ref.app_id, detail.last);
  return {
    group: detail.group,
    last: detail.last && {
      ...detail.last,
      stack_symbolicated: symbolication?.stack_symbolicated ?? null,
      symbolication_status: symbolication?.symbolication_status ?? null,
    },
    occurrences: detail.occurrences,
    trend: detail.trend,
    page: detail.page,
    sampling: detail.sampling,
    enrichment: detail.enrichment,
  };
});
