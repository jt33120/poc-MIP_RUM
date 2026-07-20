// Wrapper des route handlers v1 : auth -> rate-limit -> parsing des filtres -> exécution
// -> enveloppe { meta, data } avec ETag/304 + Cache-Control + en-têtes RateLimit-*.
// Factorise l'auth (401), le RBAC, le throttling (429), la gestion d'erreur (500) et le
// CORS pour que chaque route ne décrive que sa donnée. Importe next/server (non testé
// unitairement ; les briques pures — auth/params/cors/ratelimit/etag — le sont).
import { NextResponse, type NextRequest, after } from "next/server";
import { SESSION_COOKIE } from "../auth";
import { forwardLog } from "../log-forward";
import { type ApiPrincipal, authenticateApi } from "./auth";
import { weakEtag } from "./etag";
import { type ApiFilters, parseApiFilters } from "./params";
import { type RateResult, rateLimit } from "./ratelimit";
import { ApiHttpError, apiError } from "./respond";
import { corsHeaders } from "./cors";

export interface ApiContext {
  req: NextRequest;
  principal: ApiPrincipal;
  filters: ApiFilters;
  searchParams: URLSearchParams;
  params: Record<string, string>; // segments dynamiques de route ([id], [fingerprint]…)
}

type RouteCtx = { params: Promise<Record<string, string | string[] | undefined>> };

// Throttling : CONSOLE_API_RATE_LIMIT requêtes / minute par principal (0 = désactivé).
const RL_WINDOW_MS = 60_000;
function rlLimit(): number {
  const n = Number(process.env.CONSOLE_API_RATE_LIMIT ?? 120);
  return Number.isFinite(n) && n >= 0 ? n : 120;
}

/**
 * Construit un handler GET : authentifie, applique le rate-limit, parse les filtres (RBAC),
 * appelle `fn` et renvoie `{ meta, data }` avec ETag (304 si If-None-Match) + cache court.
 * Toute exception est journalisée et masquée en 500.
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

    // Rate limiting (best-effort, par instance).
    const limit = rlLimit();
    let rl: RateResult | null = null;
    if (limit > 0) {
      rl = rateLimit(`${principal.kind}:${principal.subject}`, limit, RL_WINDOW_MS, Date.now());
      if (!rl.ok) {
        const res = apiError(req, 429, "trop de requêtes — réessaie dans un instant");
        applyRate(res.headers, rl);
        res.headers.set("Retry-After", String(Math.ceil(rl.resetMs / 1000)));
        return res;
      }
    }

    const searchParams = new URL(req.url).searchParams;
    const filters = parseApiFilters(searchParams, principal);
    // Routes SANS segment dynamique (/api/v1/apps, /api/v1/overview…) : `params`
    // peut être absent -> défaut objet vide (sinon Object.entries(undefined) throw).
    const raw = (await route?.params) ?? {};
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") params[k] = v;
      else if (Array.isArray(v) && typeof v[0] === "string") params[k] = v[0];
    }

    try {
      const data = await fn({ req, principal, filters, searchParams, params });
      const body = JSON.stringify({
        meta: {
          app: filters.app ?? "all",
          period: filters.period,
          device: filters.device ?? "all",
          generatedAt: new Date().toISOString(),
        },
        data,
      });
      const etag = weakEtag(body);
      const headers = new Headers(corsHeaders(req.headers.get("origin")));
      headers.set("ETag", etag);
      headers.set("Cache-Control", "private, max-age=15");
      if (rl) applyRate(headers, rl);
      if (req.headers.get("if-none-match") === etag)
        return new NextResponse(null, { status: 304, headers });
      headers.set("Content-Type", "application/json");
      return new NextResponse(body, { status: 200, headers });
    } catch (e) {
      if (e instanceof ApiHttpError) return apiError(req, e.status, e.message);
      console.error("[api/v1]", req.nextUrl.pathname, e);
      // Dogfooding : remonte l'incident dans la page /logs (après la réponse, best-effort).
      after(() =>
        forwardLog("error", `[api/v1] ${req.nextUrl.pathname}: ${e instanceof Error ? e.message : String(e)}`, {
          route: req.nextUrl.pathname,
        }),
      );
      return apiError(req, 500, "erreur interne");
    }
  };
}

function applyRate(headers: Headers, rl: RateResult) {
  headers.set("RateLimit-Limit", String(rl.limit));
  headers.set("RateLimit-Remaining", String(rl.remaining));
  headers.set("RateLimit-Reset", String(Math.ceil(rl.resetMs / 1000)));
}
