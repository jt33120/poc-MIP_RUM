// Relais du hook entrant des tickets (C11) : la console transmet la livraison d'un
// fournisseur (GitHub) au NOTIFIER, qui la sert sur son domaine
// (`/v1/webhooks/tickets/{id}`), au lieu de la traiter elle-même.
//
// OCTET POUR OCTET. Le HMAC de GitHub (`X-Hub-Signature-256`) porte sur le corps
// BRUT : le relais transmet exactement les octets reçus, et les seuls en-têtes que
// la vérification et la normalisation lisent (`ENTETES_TRANSMIS`). Ni cookie, ni
// adresse.
//
// QUAND. `CONSOLE_TICKET_HOOK_URL` posée (https, sauf localhost) : relayé, sans
// pourcentage — un fournisseur rejoue ce qui échoue, et l'unicité de
// `(integration_id, delivery_id)` rend tout rejeu inoffensif. Absente (l'état
// d'aujourd'hui) : la console traite la livraison elle-même, par le même code
// (`@mip/backend/lib/integrations/tickets/webhook-entrant.mjs`).
//
// LA RÉPONSE. Signée `x-mip-notifier: 1` : rendue telle quelle (c'est le
// notifier qui parle, 4xx compris). Non signée (routeur Railway, service absent)
// ou erreur réseau : REPLI LOCAL — sûr, puisque rejouer une livraison n'applique
// rien deux fois. Délai : 8 s.
import { ENTETE_NOTIFIER } from "@mip/backend/lib/integrations/tickets/webhook-entrant.mjs";

if (typeof window !== "undefined") throw new Error("lib/ticket-hook-relay est réservé au serveur");

/** Ce que la vérification (HMAC) et la normalisation du fournisseur lisent — rien d'autre. */
export const ENTETES_TRANSMIS = Object.freeze([
  "content-type",
  "user-agent",
  "x-github-event",
  "x-github-delivery",
  "x-github-hook-id",
  "x-hub-signature-256",
] as const);

const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DELAI_MS = 8_000;

/** L'URL du notifier, ou `null` (relais éteint). */
export function lireUrlNotifier(env: Record<string, string | undefined>): string | null {
  const brute = env.CONSOLE_TICKET_HOOK_URL?.trim();
  if (!brute) return null;
  try {
    const url = new URL(brute);
    if (url.protocol === "https:" || (url.protocol === "http:" && HOTES_LOCAUX.has(url.hostname))) return url.origin;
  } catch {
    /* URL illisible : relais éteint */
  }
  return null;
}

/**
 * La réponse du notifier, ou `null` : la console traite elle-même. Ne lève jamais.
 */
export async function relayerLivraison(
  integrationId: string,
  req: Request,
  brut: Uint8Array,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<Response | null> {
  const base = lireUrlNotifier(deps.env ?? process.env);
  if (!base) return null;
  const entetes = new Headers();
  for (const nom of ENTETES_TRANSMIS) {
    const v = req.headers.get(nom);
    if (v !== null) entetes.set(nom, v);
  }
  try {
    const res = await (deps.fetch ?? fetch)(`${base}/v1/webhooks/tickets/${encodeURIComponent(integrationId)}`, {
      method: "POST",
      headers: entetes,
      body: brut as unknown as BodyInit,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (res.headers.get(ENTETE_NOTIFIER) !== "1") {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: { "content-type": "application/json", "x-content-type-options": "nosniff" },
    });
  } catch {
    return null;
  }
}
