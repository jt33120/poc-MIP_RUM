// API publique v1 (LOT C — option B) : authentification machine-à-machine.
// Deux modes, dans cet ordre :
//   1. `Authorization: Bearer <token>` comparé (temps constant) à CONSOLE_API_TOKENS
//      (liste séparée par des virgules). Pensé pour le front Angular MIP côté serveur :
//      accès lecture seule, toutes apps (rôle `viewer`, scope null).
//   2. Cookie de session JWT de la console (réutilise verifyJwt) : respecte le RBAC
//      existant (admin/viewer scopé) pour un utilisateur déjà connecté.
// Helper PUR : prend des primitives (header + valeur de cookie), aucun import next/* —
// testable sans runtime Next.
import { timingSafeEqual } from "node:crypto";
import { verifyJwt } from "../auth";

export interface ApiPrincipal {
  kind: "token" | "session";
  role: "admin" | "viewer";
  apps: string[] | null; // null = toutes les apps
  subject: string; // identité (email connecté ou "api-token")
}

function configuredTokens(): string[] {
  return (process.env.CONSOLE_API_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Comparaison à temps constant (évite les attaques par chronométrage sur le secret). */
function tokenMatches(provided: string): boolean {
  const pb = Buffer.from(provided);
  return configuredTokens().some((t) => {
    const tb = Buffer.from(t);
    return tb.length === pb.length && timingSafeEqual(tb, pb);
  });
}

/**
 * Authentifie une requête API à partir de l'en-tête Authorization et du cookie de
 * session. Retourne le principal ou null (401). Un Bearer présent mais invalide
 * échoue sans retomber sur le cookie (on ne mélange pas les modes).
 */
export async function authenticateApi(
  authorization: string | null,
  cookieToken: string | null,
): Promise<ApiPrincipal | null> {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i);
  if (bearer) {
    const tok = bearer[1].trim();
    if (tok && tokenMatches(tok))
      return { kind: "token", role: "viewer", apps: null, subject: "api-token" };
    return null;
  }
  if (cookieToken) {
    const u = await verifyJwt(cookieToken);
    if (u) return { kind: "session", role: u.role, apps: u.apps, subject: u.email };
  }
  return null;
}
