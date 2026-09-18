// Socle commun des routes d'ingestion (/api/ingest/v1/*).
//
// L'ingestion tournait en edge functions Supabase (Deno + supabase-js) ; le
// projet Supabase a disparu, et elle est reprise ici, dans la console Next.js
// déjà déployée sur Vercel. La logique d'écriture et d'auth n'est PAS
// réécrite : elle vient du paquet `ingest` (lib/pg-ingest.mjs), partagée avec
// le dev-server Node, pour qu'il n'existe qu'une implémentation.
//
// Le pool `pg` est celui de la console (lib/db.ts) : même base, même
// plafond de connexions, un seul pool par instance serverless.
import { createPgAuth } from "ingest/lib/pg-ingest.mjs";
import { corsHeaders as buildCors, originsFromRegistry } from "ingest/shared/cors.mjs";
import { createLogger } from "ingest/shared/log.mjs";
import { pool } from "./db";

export const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === "true";
export const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 600);

export const log = createLogger("ingest");

// État par instance (cache de registre 60 s, compteurs de débit) — même
// portée qu'un isolat Deno auparavant ; la limite globale reste portée par le
// compteur durable en base (rate_check).
export const auth = createPgAuth(pool, {
  requireApiKey: REQUIRE_API_KEY,
  rateLimitPerMin: RATE_LIMIT_PER_MIN,
  log,
});

/** En-têtes CORS : socle statique ∪ origines des apps actives du registre. */
export async function corsFor(
  origin: string,
  opts?: { allowHeaders?: string },
): Promise<Record<string, string>> {
  let extra: string[] = [];
  try {
    extra = originsFromRegistry((await auth.getAppRegistry()).values());
  } catch {
    // registre indisponible : on retombe sur le socle statique plutôt que de
    // refuser toute origine (même esprit fail-open que checkApiKey).
  }
  return buildCors(origin, extra, opts);
}

export const json = (
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors, ...extraHeaders },
  });

/**
 * Refus IDENTIFIÉS de la sérialisation d'écriture (P8.1), à opposer avant le 500
 * générique. Retourne null si l'erreur n'en est pas un.
 *
 * Distinguer les deux compte pour le client : `409` dit « ta demande vise un
 * autre locataire, la rejouer ne changera rien » et `503` dit « la base était
 * occupée, rien n'a été écrit, rejoue ». Les confondre en 500 ferait tourner
 * indéfiniment la file de rejeu du SDK sur une demande qui ne peut pas aboutir.
 */
export function refusIngestion(
  err: unknown,
  cors: Record<string, string>,
): Response | null {
  const nom = (err as { name?: string } | null)?.name;
  if (nom === "ErreurPorteeApp") {
    const message = String((err as Error).message);
    log.warn("rejected: app scope", { reason: message });
    return json({ error: message }, 409, cors);
  }
  if (nom === "ErreurVerrouIngestion") {
    log.warn("busy: app ingest lock", { apps: (err as { apps?: string[] }).apps });
    return json({ error: "ingestion busy, retry", retry: true }, 503, cors, {
      "retry-after": "2",
    });
  }
  return null;
}

/**
 * Gardes communes aux routes OTLP : clé d'API (403) puis débit (429), une fois
 * par app présente dans le lot. Retourne une Response à renvoyer telle quelle,
 * ou null si la requête passe.
 */
export async function guardApps(
  apiKeys: Array<{ app_id: string; api_key: string | null }>,
  cors: Record<string, string>,
): Promise<Response | null> {
  for (const { app_id, api_key } of apiKeys) {
    const reason = await auth.checkApiKey(app_id, api_key);
    if (reason) {
      log.warn("rejected: api key", { app_id, reason });
      return json({ error: reason }, 403, cors);
    }
  }
  for (const appId of new Set(apiKeys.map((k) => k.app_id))) {
    if (await auth.rateLimitedDurable(appId)) {
      log.warn("rate limited", { app_id: appId, limit: RATE_LIMIT_PER_MIN });
      return json({ error: `rate limit exceeded for app: ${appId}` }, 429, cors, {
        "retry-after": "60",
      });
    }
  }
  return null;
}
