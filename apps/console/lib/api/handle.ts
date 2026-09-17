// Wrapper des route handlers v1 : auth -> rate-limit -> parsing des filtres -> exécution
// -> enveloppe { meta, data } avec ETag/304 + Cache-Control + en-têtes RateLimit-*.
// Factorise l'auth (401), le RBAC, le throttling (429), la gestion d'erreur (500) et le
// CORS pour que chaque route ne décrive que sa donnée. Importe next/server (non testé
// unitairement ; les briques pures — auth/params/cors/ratelimit/etag — le sont).
import { NextResponse, type NextRequest, after } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "ingest/lib/sourcemap-upload.mjs";
import { bodyTooLarge } from "ingest/shared/limits.mjs";
import { SESSION_COOKIE, type SessionUser } from "../auth";
import { forwardLog } from "../log-forward";
import { traceFields } from "../server-trace-core";
import { guardAdmin } from "./admin";
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
    const params = await segments(route);

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
      return erreurHandler(req, e);
    }
  };
}

/** ApiHttpError rendue telle quelle ; toute autre exception journalisée et masquée en 500. */
function erreurHandler(req: NextRequest, e: unknown) {
  if (e instanceof ApiHttpError) return apiError(req, e.status, e.message, e.details);
  console.error("[api/v1]", req.nextUrl.pathname, e);
  // Dogfooding : remonte l'incident dans la page /logs (après la réponse, best-effort).
  // La corrélation est capturée MAINTENANT, pas dans le callback : le contexte
  // ALS de la trace n'est pas garanti à l'intérieur de after().
  const corr = traceFields();
  after(() =>
    forwardLog("error", `[api/v1] ${req.nextUrl.pathname}: ${e instanceof Error ? e.message : String(e)}`, {
      ...corr,
      route: req.nextUrl.pathname,
    }),
  );
  return apiError(req, 500, "erreur interne");
}

async function segments(route: RouteCtx): Promise<Record<string, string>> {
  const raw = (await route?.params) ?? {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") params[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") params[k] = v[0];
  }
  return params;
}

export interface ApiMutationContext {
  req: NextRequest;
  /** Session admin non démo, même origine. */
  user: SessionUser;
  body: unknown;
  params: Record<string, string>;
}

/** Réponse d'une mutation : `app` renseigne `meta`, `status` vaut 200 par défaut. */
export interface ApiMutationResult {
  app: string;
  data: unknown;
  status?: 200 | 201;
}

/** Corps JSON d'une mutation : quelques kilo-octets suffisent à un commentaire de 2 000 caractères. */
const MUTATION_MAX_BYTES = 16 * 1024;

/**
 * Construit un handler POST de l'API v1 réservé aux mutations d'un humain :
 * 401 sans authentification ; 403 pour un jeton CONSOLE_API_TOKENS (lecture
 * seule), une session viewer ou démo, ou une Origin étrangère (CSRF) ; 429 au-delà
 * du débit ; 413 au-delà de 16 Kio ; 400 si le corps n'est pas du JSON. `/api/v1`
 * contourne le middleware : ces gardes sont donc TOUTES ici. Réponse `{ meta, data }`.
 */
export function handleMutation(fn: (ctx: ApiMutationContext) => Promise<ApiMutationResult>) {
  return async (req: NextRequest, route: RouteCtx) => {
    const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? null;
    const principal = await authenticateApi(req.headers.get("authorization"), cookie);
    if (!principal)
      return apiError(req, 401, "authentification requise (session de la console)");
    if (principal.kind === "token")
      return apiError(req, 403, "jeton d'API en lecture seule : mutation refusée");
    const garde = await guardAdmin(req.headers, cookie, { mutation: true });
    if (!garde.ok) return apiError(req, garde.status, garde.error);

    const limit = rlLimit();
    if (limit > 0) {
      const rl = rateLimit(`mutation:${garde.user.email}`, limit, RL_WINDOW_MS, Date.now());
      if (!rl.ok) {
        const res = apiError(req, 429, "trop de requêtes — réessaie dans un instant");
        applyRate(res.headers, rl);
        res.headers.set("Retry-After", String(Math.ceil(rl.resetMs / 1000)));
        return res;
      }
    }

    if (bodyTooLarge(req.headers.get("content-length"), MUTATION_MAX_BYTES))
      return apiError(req, 413, "corps de requête trop volumineux (16 Kio au plus)");
    if (!req.body) return apiError(req, 400, "corps JSON requis");
    let body: unknown;
    try {
      // Le ReadableStream web de Node est itérable de façon asynchrone.
      const flux = req.body as unknown as AsyncIterable<Uint8Array>;
      body = JSON.parse((await lireCorpsLimite(flux, { max: MUTATION_MAX_BYTES })).toString("utf8"));
    } catch (e) {
      if (e instanceof ErreurUpload && e.statut === 413)
        return apiError(req, 413, "corps de requête trop volumineux (16 Kio au plus)");
      return apiError(req, 400, "corps JSON invalide");
    }

    try {
      const result = await fn({ req, user: garde.user, body, params: await segments(route) });
      const headers = new Headers(corsHeaders(req.headers.get("origin")));
      headers.set("Cache-Control", "no-store");
      return NextResponse.json(
        { meta: { app: result.app, generatedAt: new Date().toISOString() }, data: result.data },
        { status: result.status ?? 200, headers },
      );
    } catch (e) {
      return erreurHandler(req, e);
    }
  };
}

function applyRate(headers: Headers, rl: RateResult) {
  headers.set("RateLimit-Limit", String(rl.limit));
  headers.set("RateLimit-Remaining", String(rl.remaining));
  headers.set("RateLimit-Reset", String(Math.ceil(rl.resetMs / 1000)));
}
