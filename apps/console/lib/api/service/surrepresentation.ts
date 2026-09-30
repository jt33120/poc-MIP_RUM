// GET /api/v1/errors/{fingerprint}/overrepresentation — SERVIE PAR LE SERVICE `api`
// SEUL (`ROUTES_SERVICE_SEUL` de `services/api/routeur.mjs`) ; la route de la console
// la transmet (`lib/api/service-seul.ts`) et n'exécute jamais ce module.
//
// Les valeurs de session sur-représentées parmi les sessions touchées par un groupe
// d'erreurs : navigateur, système, appareil, pays estimé, release de la session.
// Effectifs lus par `lib/queries-surrepresentation.ts`, test du paquet `@mip/stats`,
// réponse assemblée par `lib/api/surrepresentation.ts`.
//
// UNE EMPREINTE N'IDENTIFIE PAS UN GROUPE : même résolution que le détail
// (`/errors/{fingerprint}`) — sans `app`, une empreinte présente dans plusieurs apps
// du périmètre est refusée (400, apps candidates listées) ; `meta.app` annonce l'app
// dont viennent les chiffres.
import { effectifsDuGroupe } from "../../queries-surrepresentation";
import { errorDeviceFrom, isFingerprintParam, resolveErrorGroup, type ErrorFilters } from "../../queries-errors";
import { handle } from "../handle";
import { announceResourceApp } from "../params";
import { ApiHttpError, preflight } from "../respond";
import { surrepresentationDuGroupe } from "../surrepresentation";

export const OPTIONS = preflight;

const INTROUVABLE = "groupe d'erreurs introuvable";

export const GET = handle(async ({ filters, params }) => {
  const fingerprint = params.fingerprint ?? "";
  if (!isFingerprintParam(fingerprint)) throw new ApiHttpError(400, "fingerprint invalide");
  // Comme le détail : `legacy` + tablette, jamais `filters.v2.device`.
  const f: ErrorFilters = { ...filters.legacy, device: errorDeviceFrom(filters.device) };
  const resolution =
    f.app !== null
      ? await resolveErrorGroup(fingerprint, f, null)
      : await resolveErrorGroup(fingerprint, f, filters.query.scope.authorizedApps);
  if (resolution.kind === "not_found") throw new ApiHttpError(404, INTROUVABLE);
  if (resolution.kind === "ambiguous") {
    throw new ApiHttpError(
      400,
      `fingerprint présent dans plusieurs apps : préciser app (${resolution.candidates.map((c) => c.app_id).join(", ")})`,
    );
  }
  const { ref } = resolution;
  const effectifs = await effectifsDuGroupe(ref, f);
  announceResourceApp(filters, ref.app_id);
  return surrepresentationDuGroupe(ref, effectifs);
});
