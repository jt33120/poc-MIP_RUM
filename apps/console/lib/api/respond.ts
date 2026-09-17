// Réponses JSON de l'API v1 : enveloppe stable + en-têtes CORS. Importe next/server
// (utilisé uniquement par les route handlers, pas testé unitairement — la logique
// pure est dans cors.ts / params.ts / auth.ts).
import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders } from "./cors";

/** Enveloppe de réponse : { meta, data } — contrat documenté dans docs/API_CONSOLE.md. */
export interface ApiEnvelope<T> {
  meta: {
    app: string; // 'all' ou l'app effective (après scoping)
    period: string; // '1h' | '24h' | '7d'
    device: string; // 'all' ou le device demandé
    generatedAt: string; // ISO 8601
  };
  data: T;
}

export function apiJson(
  req: NextRequest,
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export function apiError(
  req: NextRequest,
  status: number,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return apiJson(req, { ...details, error: message }, { status });
}

/** Réponse au préflight CORS (OPTIONS). */
export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

/**
 * Erreur HTTP « attendue » (404, 400…) à lancer depuis un handler : le wrapper la
 * traduit en réponse avec le bon statut au lieu de la masquer en 500. `details`
 * complète le corps d'erreur (ex. la révision courante d'un 409).
 */
export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}
