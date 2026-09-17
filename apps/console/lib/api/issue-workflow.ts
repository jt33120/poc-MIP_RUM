// Traduction HTTP du workflow d'une issue (P5.6), partagée par ses routes v1 :
// chaque issue de lib/error-issue-workflow.ts a son statut, et un 409 rend la
// révision courante pour que l'écran propose de recharger.
import type { SessionUser } from "../auth";
import type { WorkflowResult } from "../error-issue-workflow";
import { errorScopeFor, scopeApps } from "../queries-errors";
import { ApiHttpError } from "./respond";

export const ISSUE_INTROUVABLE = "issue introuvable";

/** Apps d'une session pour le workflow : null = toutes (admin), [] = aucune. */
export function workflowApps(user: Pick<SessionUser, "role" | "apps">): string[] | null {
  return scopeApps(errorScopeFor(user));
}

/** La valeur d'un résultat réussi, ou l'ApiHttpError correspondante. */
export function valeurOuErreur<T>(result: WorkflowResult<T>): T {
  switch (result.kind) {
    case "ok":
      return result.value;
    case "unavailable":
      throw new ApiHttpError(503, "workflow des issues indisponible : migration-v73 non appliquée");
    case "forbidden":
      throw new ApiHttpError(403, result.error);
    case "not_found":
      throw new ApiHttpError(404, ISSUE_INTROUVABLE);
    case "conflict":
      throw new ApiHttpError(409, result.error, { revision: result.revision });
    case "invalid":
      throw new ApiHttpError(400, result.error);
  }
}
