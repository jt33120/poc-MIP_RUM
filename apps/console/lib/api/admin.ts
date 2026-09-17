// Garde des routes API d'administration (P5.4 : source maps et jetons de CI).
//
// Session admin signée, jamais une session démo, et MÊME ORIGINE pour toute
// mutation : le cookie de session part avec n'importe quelle requête de premier
// niveau, l'en-tête Origin dit qui l'a émise. Un Origin absent est refusé — un
// navigateur l'envoie sur tout POST/DELETE ; un script de CI n'a rien à faire
// ici, il passe par le jeton dédié. Les jetons CONSOLE_API_TOKENS ne sont PAS
// acceptés : ils restent en lecture seule.
//
// PUR : en-têtes et valeur du cookie en entrée, aucun import next/* — testable
// sans runtime Next.
import { type SessionUser, verifyJwt } from "../auth";

export type AdminGuard = { ok: true; user: SessionUser } | { ok: false; status: 401 | 403; error: string };

/** L'origine émettrice est-elle l'hôte qui sert la console ? */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function guardAdmin(
  headers: Headers,
  sessionCookie: string | null,
  { mutation }: { mutation: boolean },
): Promise<AdminGuard> {
  const user = sessionCookie ? await verifyJwt(sessionCookie) : null;
  if (!user) return { ok: false, status: 401, error: "session requise" };
  if (user.role !== "admin" || user.demo) return { ok: false, status: 403, error: "réservé aux administrateurs" };
  if (mutation && !sameOrigin(headers)) return { ok: false, status: 403, error: "origine de la requête refusée" };
  return { ok: true, user };
}
