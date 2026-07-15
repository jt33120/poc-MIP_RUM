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

/** Un jeton machine + son périmètre d'apps (null = toutes). */
export interface TokenConfig {
  token: string;
  apps: string[] | null;
}

/**
 * Parse CONSOLE_API_TOKENS. Entrées séparées par des virgules. Deux formes :
 *   - `token`            -> accès toutes apps (rétro-compatible) ;
 *   - `token@app1;app2`  -> accès SCOPÉ à ces apps (comme un viewer scopé).
 * Un partenaire (ex. UTI) reçoit ainsi un jeton qui ne voit que son app.
 * Fonction PURE (testée, réutilisée par l'auth).
 */
export function parseTokenConfig(raw: string | undefined): TokenConfig[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf("@");
      if (at === -1) return { token: entry, apps: null };
      const token = entry.slice(0, at).trim();
      const apps = entry
        .slice(at + 1)
        .split(";")
        .map((a) => a.trim())
        .filter(Boolean);
      return { token, apps: apps.length ? apps : null };
    })
    .filter((c) => c.token);
}

/** Comparaison de secrets à temps constant (longueurs différentes -> false). */
export function secretEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `Authorization: Bearer <secret>` comparé à `secret` en temps constant. */
export function bearerMatches(authHeader: string | null, secret: string): boolean {
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  return m ? secretEquals(m[1].trim(), secret) : false;
}

/**
 * Jeton correspondant (comparaison à temps constant sur la partie secrète), ou null.
 * On parcourt TOUTES les entrées pour ne pas fuiter par chronométrage laquelle a matché.
 */
function matchToken(provided: string): TokenConfig | null {
  const pb = Buffer.from(provided);
  let match: TokenConfig | null = null;
  for (const c of parseTokenConfig(process.env.CONSOLE_API_TOKENS)) {
    const tb = Buffer.from(c.token);
    if (tb.length === pb.length && timingSafeEqual(tb, pb)) match = c;
  }
  return match;
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
    const cfg = tok ? matchToken(tok) : null;
    if (cfg)
      return {
        kind: "token",
        role: "viewer",
        apps: cfg.apps,
        subject: cfg.apps ? `api-token:${cfg.apps.join("|")}` : "api-token",
      };
    return null;
  }
  if (cookieToken) {
    const u = await verifyJwt(cookieToken);
    if (u) return { kind: "session", role: u.role, apps: u.apps, subject: u.email };
  }
  return null;
}
