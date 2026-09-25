// Traduction HTTP des vues enregistrées (P6.5), partagée par leurs deux routes.
// Un 409 rend la révision courante pour que l'écran propose de recharger ; un
// plafond atteint est un 422, qu'aucun rechargement ne résoudrait.
import type { ApiPrincipal } from "./auth";
import type { SavedViewResult, SavedViewRow } from "../queries-saved-views";
import { VUE_INTROUVABLE } from "../queries-saved-views";
import { ApiHttpError } from "./respond";

/** La valeur d'un résultat réussi, ou l'ApiHttpError correspondante. */
export function valeurOuErreur<T>(result: SavedViewResult<T>): T {
  switch (result.kind) {
    case "ok":
      return result.value;
    case "unavailable":
      throw new ApiHttpError(503, "vues enregistrées indisponibles : migration-v79 non appliquée");
    case "forbidden":
      throw new ApiHttpError(403, result.error);
    case "not_found":
      throw new ApiHttpError(404, VUE_INTROUVABLE);
    case "conflict":
      throw new ApiHttpError(409, result.error, { revision: result.revision });
    case "limit":
      throw new ApiHttpError(422, result.error);
  }
}

/**
 * Une vue est PERSONNELLE : un jeton `CONSOLE_API_TOKENS` n'en possède aucune et
 * ne doit surtout pas lire celles d'un opérateur. Il reçoit un refus explicite —
 * pas une liste vide, qui se lirait comme « aucune vue n'existe ».
 */
export function refuserJeton(principal: ApiPrincipal): void {
  if (principal.kind === "token") {
    throw new ApiHttpError(
      403,
      "les vues enregistrées sont personnelles : un jeton d'API n'en possède aucune et n'accède pas à celles d'un opérateur",
      { code: "forbidden_token" },
    );
  }
}

/** Forme publique d'une vue : jamais l'identifiant interne de son propriétaire. */
export function vuePublique(view: SavedViewRow): Record<string, unknown> {
  return {
    id: view.id,
    app: view.app_id,
    name: view.name,
    query: view.query,
    revision: view.revision,
    mine: view.mine,
    owner_email: view.owner_email,
    created_at: new Date(view.created_at).toISOString(),
    updated_at: new Date(view.updated_at).toISOString(),
  };
}
