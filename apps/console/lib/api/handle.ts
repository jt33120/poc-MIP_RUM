// Wrapper des route handlers v1 : auth -> rate-limit -> parsing des filtres -> exécution
// -> enveloppe { meta, data } avec ETag/304 + Cache-Control + en-têtes RateLimit-*.
// Factorise l'auth (401), le RBAC, le throttling (429), la gestion d'erreur (500) et le
// CORS pour que chaque route ne décrive que sa donnée. Importe next/server (non testé
// unitairement ; les briques pures — auth/params/cors/ratelimit/etag — le sont).
import { NextResponse, type NextRequest, after } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "@mip/backend/lib/sourcemap-upload.mjs";
import { bodyTooLarge } from "@mip/backend/shared/limits.mjs";
import { SESSION_COOKIE, type SessionUser } from "../auth";
import { forwardLog } from "../log-forward";
import { traceFields } from "../server-trace-core";
import { guardAdmin, guardSession } from "./admin";
import { type ApiPrincipal, authenticateApi } from "./auth";
import { UnsupportedFilterError } from "../query-compiler";
import { ExplorerBudgetError, UnsupportedExplorerDimension } from "../analytics-schema";
import { conditionsOf, contractErrorStatus, queryFingerprint } from "../query-contract";
import { weakEtag } from "./etag";
import { type ApiFilters, parseApiFilters } from "./params";
import { type RateResult, rateLimit } from "./ratelimit";
import { ApiHttpError, apiError } from "./respond";
import { corsHeaders } from "./cors";
import { relayerLectureApi } from "../api-relay";

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
    // P4 : une lecture au jeton machine peut partir au service `api` (éteint par
    // défaut ; voir lib/api-relay.ts). Sa réponse est rendue telle quelle.
    const relayee = await relayerLectureApi(req);
    if (relayee) return relayee;
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
    // Contrat commun : périmètre signé, plage et filtres résolus avant toute lecture.
    // Liste d'apps vide ou app hors périmètre : 403 ; entrée invalide : 400 typé.
    const parsed = parseApiFilters(searchParams, principal);
    if (!parsed.ok) {
      const { code, message, parameter, dimension } = parsed.error;
      return apiError(req, contractErrorStatus(parsed.error), message, {
        code,
        ...(parameter ? { parameter } : {}),
        ...(dimension ? { dimension } : {}),
      });
    }
    const filters = parsed.value;
    // Routes SANS segment dynamique (/api/v1/apps, /api/v1/overview…) : `params`
    // peut être absent -> défaut objet vide (sinon Object.entries(undefined) throw).
    const params = await segments(route);

    try {
      const data = await fn({ req, principal, filters, searchParams, params });
      const { query } = filters;
      const meta = {
        app: filters.app ?? "all",
        period: filters.period,
        device: filters.device ?? "all",
        // Ajouts P6.2 : ce qui a RÉELLEMENT été appliqué, pas ce qui était demandé.
        query_version: query.version,
        scope: { requested_app: query.scope.requestedApp, effective_apps: query.scope.effectiveApps },
        range: {
          from: query.range.from,
          to: query.range.to,
          preset: query.range.preset,
          bucket_seconds: query.range.bucketSeconds,
        },
        filters: {
          conditions: conditionsOf(query.filters),
          include_bots: query.filters.includeBots,
          include_internal: query.filters.includeInternal,
        },
      };
      const body = JSON.stringify({ meta: { ...meta, generatedAt: new Date().toISOString() }, data });
      // L'ETag couvre le principal, l'empreinte de la requête résolue et la donnée —
      // pas l'horodatage de génération : une réponse calculée pour A ne vaut jamais pour B.
      // Fenêtre glissante : son preset, pas ses instants, qui avancent à chaque appel ;
      // une donnée inchangée revalide donc en 304 (ETag faible, représentation équivalente).
      const fenetre = { preset: meta.range.preset, bucket_seconds: meta.range.bucket_seconds };
      const etag = weakEtag(
        JSON.stringify([
          principal.kind,
          principal.subject,
          principal.apps,
          queryFingerprint(query, "sliding"),
          { ...meta, range: query.range.preset ? fenetre : meta.range },
          data,
        ]),
      );
      const headers = new Headers(corsHeaders(req.headers.get("origin")));
      headers.set("ETag", etag);
      headers.set("Cache-Control", "private, max-age=15");
      // Ajouté à `Vary: Origin` du CORS, jamais à sa place.
      headers.append("Vary", "Authorization, Cookie");
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

/**
 * ApiHttpError rendue telle quelle ; un filtre que la lecture ne sait pas appliquer
 * est un 400 typé (jamais un résultat qui l'ignore) ; toute autre exception est
 * journalisée et masquée en 500.
 */
function erreurHandler(req: NextRequest, e: unknown) {
  if (e instanceof ApiHttpError) return apiError(req, e.status, e.message, e.details);
  if (e instanceof UnsupportedFilterError) {
    return apiError(req, 400, e.error.message, {
      code: e.error.code,
      ...(e.error.dimension ? { dimension: e.error.dimension } : {}),
    });
  }
  // L'Explorer n'a pas pu tenir son budget de lecture. 503 : le service dit qu'il
  // n'a pas répondu, au lieu de rendre une série de zéros qu'on lirait comme du calme.
  if (e instanceof ExplorerBudgetError) return apiError(req, 503, e.message, { code: e.code });
  if (e instanceof UnsupportedExplorerDimension) {
    return apiError(req, 400, e.message, { code: e.code, ...(e.dimension ? { dimension: e.dimension } : {}) });
  }
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

export interface ApiQueryContext {
  req: NextRequest;
  principal: ApiPrincipal;
  /** Corps JSON déjà borné et désérialisé ; sa validation appartient à la route. */
  body: unknown;
}

/**
 * Handler POST de LECTURE (Explorer P6.4). Un POST, pas parce qu'il écrit — il
 * n'écrit rien — mais parce qu'une requête analytique ne tient pas dans une query
 * string : elle porte un AST. D'où trois conséquences assumées :
 *
 *   · MÊME AUTH QUE `GET` : jeton `CONSOLE_API_TOKENS` en lecture seule accepté,
 *     session admin ou viewer aussi. `handleMutation` les refuse, lui — et c'est
 *     justement pourquoi ce chemin est séparé plutôt que réutilisé.
 *   · AUCUNE GARDE CSRF D'ÉCRITURE : elle protège un changement d'état, et il n'y
 *     en a pas. Le périmètre reste celui du principal signé ; une origine tierce
 *     ne lit la réponse que si le CORS l'autorise déjà.
 *   · `no-store` : la réponse dépend d'un corps, qu'aucun cache HTTP ne sait
 *     prendre en compte. Mieux vaut ne pas la mettre en cache que la partager.
 *
 * Corps refusé au-delà de `maxBytes` (413) ou s'il n'est pas du JSON (400).
 */
export function handleQuery(
  fn: (ctx: ApiQueryContext) => Promise<{ meta: Record<string, unknown>; data: unknown }>,
  options: { maxBytes: number },
) {
  return async (req: NextRequest) => {
    // P4 : la lecture de l'Explorer au jeton machine peut partir au service `api`.
    const relayee = await relayerLectureApi(req);
    if (relayee) return relayee;
    const principal = await authenticateApi(
      req.headers.get("authorization"),
      req.cookies.get(SESSION_COOKIE)?.value ?? null,
    );
    if (!principal)
      return apiError(req, 401, "authentification requise (cookie de session ou en-tête Authorization: Bearer <token>)");

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

    const tropGros = `corps de requête trop volumineux (${Math.floor(options.maxBytes / 1024)} Kio au plus)`;
    // L'en-tête annoncé est vérifié AVANT la lecture ; la lecture le revérifie
    // octet par octet, car un client peut annoncer moins qu'il n'envoie.
    if (bodyTooLarge(req.headers.get("content-length"), options.maxBytes))
      return apiError(req, 413, tropGros, { code: "body_too_large" });
    if (!req.body) return apiError(req, 400, "corps JSON requis", { code: "invalid_query" });
    let body: unknown;
    try {
      const flux = req.body as unknown as AsyncIterable<Uint8Array>;
      body = JSON.parse((await lireCorpsLimite(flux, { max: options.maxBytes })).toString("utf8"));
    } catch (e) {
      if (e instanceof ErreurUpload && e.statut === 413) return apiError(req, 413, tropGros, { code: "body_too_large" });
      return apiError(req, 400, "corps JSON invalide", { code: "invalid_query" });
    }

    try {
      const { meta, data } = await fn({ req, principal, body });
      const headers = new Headers(corsHeaders(req.headers.get("origin")));
      headers.set("Cache-Control", "no-store");
      headers.append("Vary", "Authorization, Cookie");
      if (rl) applyRate(headers, rl);
      return NextResponse.json({ meta: { ...meta, generatedAt: new Date().toISOString() }, data }, { headers });
    } catch (e) {
      return erreurHandler(req, e);
    }
  };
}

export interface ApiMutationContext {
  req: NextRequest;
  /** Session admin non démo, même origine. */
  user: SessionUser;
  body: unknown;
  params: Record<string, string>;
}

/**
 * Réponse d'une mutation : `app` renseigne `meta`, `status` vaut 200 par défaut.
 *
 * `202` existe depuis P8.6 : une demande de ticket est ACCEPTÉE, pas honorée —
 * la ressource distante n'existe pas encore quand on répond. Rendre 201 y serait
 * un mensonge, et 200 laisserait croire que tout est fini.
 */
export interface ApiMutationResult {
  app: string;
  data: unknown;
  status?: 200 | 201 | 202;
}

/** Corps JSON d'une mutation : quelques kilo-octets suffisent à un commentaire de 2 000 caractères. */
const MUTATION_MAX_BYTES = 16 * 1024;

export interface MutationOptions {
  /**
   * `admin` (défaut) : mutations d'administration, réservées au rôle admin.
   * `session` : écriture PERSONNELLE, ouverte à toute session non démo — le
   * périmètre et la propriété sont vérifiés par la ressource elle-même.
   */
  role?: "admin" | "session";
  /** `false` : la méthode n'a pas de corps (DELETE), et `body` vaut alors null. */
  body?: boolean;
  /** Corps accepté, en octets. Défaut : 16 Kio. */
  maxBytes?: number;
}

/**
 * Construit un handler d'ÉCRITURE de l'API v1, réservé à un humain connecté :
 * 401 sans authentification ; 403 pour un jeton CONSOLE_API_TOKENS (lecture
 * seule), une session démo, une Origin étrangère (CSRF) et, en mode `admin`, une
 * session viewer ; 429 au-delà du débit ; 413 au-delà de la taille ; 400 si le
 * corps n'est pas du JSON. `/api/v1` contourne le middleware : ces gardes sont
 * donc TOUTES ici. Réponse `{ meta, data }`.
 */
export function handleMutation(
  fn: (ctx: ApiMutationContext) => Promise<ApiMutationResult>,
  options: MutationOptions = {},
) {
  const attendCorps = options.body !== false;
  const maxBytes = options.maxBytes ?? MUTATION_MAX_BYTES;
  const tropGros = `corps de requête trop volumineux (${Math.floor(maxBytes / 1024)} Kio au plus)`;
  return async (req: NextRequest, route: RouteCtx) => {
    const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? null;
    const principal = await authenticateApi(req.headers.get("authorization"), cookie);
    if (!principal)
      return apiError(req, 401, "authentification requise (session de la console)");
    if (principal.kind === "token")
      return apiError(req, 403, "jeton d'API en lecture seule : mutation refusée");
    const garde =
      options.role === "session"
        ? await guardSession(req.headers, cookie, { mutation: true })
        : await guardAdmin(req.headers, cookie, { mutation: true });
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

    let body: unknown = null;
    if (attendCorps) {
      if (bodyTooLarge(req.headers.get("content-length"), maxBytes)) return apiError(req, 413, tropGros);
      if (!req.body) return apiError(req, 400, "corps JSON requis");
      try {
        // Le ReadableStream web de Node est itérable de façon asynchrone.
        const flux = req.body as unknown as AsyncIterable<Uint8Array>;
        body = JSON.parse((await lireCorpsLimite(flux, { max: maxBytes })).toString("utf8"));
      } catch (e) {
        if (e instanceof ErreurUpload && e.statut === 413) return apiError(req, 413, tropGros);
        return apiError(req, 400, "corps JSON invalide");
      }
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
