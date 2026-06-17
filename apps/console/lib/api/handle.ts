// Wrapper des route handlers v1 : auth -> parsing des filtres -> exécution -> enveloppe.
// Factorise l'auth (401), le scoping RBAC, la gestion d'erreur (500) et les en-têtes
// CORS pour que chaque route ne décrive que sa donnée. Importe next/server (non testé
// unitairement ; couvert par le build + les helpers purs sous-jacents).
import { type NextRequest } from "next/server";
import { SESSION_COOKIE } from "../auth";
import { type ApiPrincipal, authenticateApi } from "./auth";
import { type ApiFilters, parseApiFilters } from "./params";
import { ApiHttpError, apiError, apiJson } from "./respond";

export interface ApiContext {
  req: NextRequest;
  principal: ApiPrincipal;
  filters: ApiFilters;
  searchParams: URLSearchParams;
  params: Record<string, string>; // segments dynamiques de route ([id], [fingerprint]…)
}

// Forme du contexte de route attendue par Next 15 (params dynamiques résolus en
// Promise). On la garde large pour satisfaire le validateur de route, et on aplatit
// vers Record<string,string> pour les handlers.
type RouteCtx = { params: Promise<Record<string, string | string[] | undefined>> };

/**
 * Construit un handler GET : authentifie, parse les filtres (avec RBAC), appelle `fn`
 * et renvoie `{ meta, data }`. Toute exception est journalisée et masquée en 500.
 */
export function handle(fn: (ctx: ApiContext) => Promise<unknown>) {
  return async (req: NextRequest, route: RouteCtx) => {
    const principal = await authenticateApi(
      req.headers.get("authorization"),
      req.cookies.get(SESSION_COOKIE)?.value ?? null,
    );
    if (!principal)
      return apiError(
        req,
        401,
        "authentification requise (cookie de session ou en-tête Authorization: Bearer <token>)",
      );

    const searchParams = new URL(req.url).searchParams;
    const filters = parseApiFilters(searchParams, principal);
    const raw = await route.params;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") params[k] = v;
      else if (Array.isArray(v) && typeof v[0] === "string") params[k] = v[0];
    }

    try {
      const data = await fn({ req, principal, filters, searchParams, params });
      return apiJson(req, {
        meta: {
          app: filters.app ?? "all",
          period: filters.period,
          device: filters.device ?? "all",
          generatedAt: new Date().toISOString(),
        },
        data,
      });
    } catch (e) {
      if (e instanceof ApiHttpError) return apiError(req, e.status, e.message);
      console.error("[api/v1]", req.nextUrl.pathname, e);
      return apiError(req, 500, "erreur interne");
    }
  };
}
