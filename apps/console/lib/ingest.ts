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
import { createPgAuth } from "@mip/backend/lib/pg-ingest.mjs";
import { corsHeaders as buildCors, originsFromRegistry } from "@mip/backend/shared/cors.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";
import { corpsReponseOtlp, formatOtlp, TYPE_JSON } from "@mip/backend/shared/otlp-corps.mjs";
import { estIndisponibilite } from "@mip/backend/shared/retry.mjs";
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
 * Met la réponse d'une route OTLP au format de la REQUÊTE : une requête
 * protobuf reçoit un corps protobuf (vide sur un 2xx, `google.rpc.Status` sinon)
 * et `content-type: application/x-protobuf` — la spec OTLP/HTTP l'exige, et les
 * exportateurs officiels décodent en protobuf tout corps non vide.
 *
 * UNE conversion en sortie de route plutôt qu'un format passé à chaque `json()` :
 * les refus viennent de partout (`guardApps`, `refusIngestion`, le relais…), et
 * une branche oubliée répondrait du JSON à un client protobuf. Le receveur du
 * collector fait de même, au même endroit logique (`repondre`). Une réponse déjà
 * en protobuf — relayée depuis le collector — passe telle quelle.
 */
export async function formaterReponseOtlp(req: Request, res: Response): Promise<Response> {
  if (formatOtlp(req.headers.get("content-type")) !== "protobuf") return res;
  if (res.headers.get("content-type") !== TYPE_JSON) return res;
  const corps: unknown = await res.json().catch(() => null);
  const { contentType, octets } = corpsReponseOtlp("protobuf", res.status, corps);
  const entetes = new Headers(res.headers);
  entetes.set("content-type", contentType);
  return new Response(octets.length ? new Uint8Array(octets) : null, { status: res.status, headers: entetes });
}

/**
 * La requête a-t-elle été coupée par le CLIENT pendant la lecture de son corps
 * (onglet fermé, navigation, beacon interrompu) ? Node lève alors `Error: aborted`,
 * code `ECONNRESET` — le même code qu'une connexion à la base coupée, que
 * `estIndisponibilite` range en panne de base. Une coupure côté base ne porte
 * jamais ce message (« read ECONNRESET », « Connection terminated… »).
 */
export function estAbandonClient(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown } | null;
  return e?.message === "aborted" && (e.code === "ECONNRESET" || e.code === undefined);
}

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
  // Requête abandonnée par le client : rien n'est écrit, personne n'attend la
  // réponse. Journalisée comme telle — « busy: database unavailable » brouillait
  // l'exploitation, la base n'y était pour rien (contre-recette du 26/09/2026).
  if (estAbandonClient(err)) {
    log.info("aborted: client closed the request", {});
    return json({ error: "request aborted by client" }, 400, cors);
  }
  // Base injoignable au-delà des reprises (`withRetry`) : la transaction n'a pas
  // commencé ou a été annulée, rien n'est écrit, et rejouer plus tard réussira.
  // 503 + retry-after, comme le collector — c'était un 500 ici, et la même panne
  // rendait donc deux statuts selon le port qui la recevait (contrat de parité,
  // `tests/contract/ingest-parity.test.ts`). Le SDK rejoue les deux ; seul le
  // 503 porte le `retry-after` qui étale les rejeux d'un parc entier.
  if (estIndisponibilite(err)) {
    log.warn("busy: database unavailable", { code: (err as { code?: string } | null)?.code ?? null });
    return json({ error: "ingestion unavailable, retry", retry: true }, 503, cors, {
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
