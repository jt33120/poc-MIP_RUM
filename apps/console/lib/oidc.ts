// SSO enterprise (P0) — OpenID Connect (Authorization Code + PKCE).
// Cœur sans import next/* : config, PKCE, URL d'autorisation, mapping des claims,
// validation de l'ID token (jose). Testable sans IdP (la validation prend un
// résolveur de clés en paramètre → on l'exerce avec une clé locale en test).
// Le flux réseau (discovery, échange de code) vit dans les route handlers.
import { createHash, randomBytes } from "node:crypto";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string; // ex: "openid email profile"
  roleClaim: string | null; // claim portant les rôles/groupes (ex: "groups")
  adminValues: string[]; // valeurs de roleClaim donnant le rôle admin
  appsClaim: string | null; // claim portant la liste d'app_id (viewer scopé)
}

/** Lit la config OIDC depuis l'environnement. null = SSO désactivé (variables absentes). */
export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim();
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
  const redirectUri = process.env.OIDC_REDIRECT_URI?.trim();
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;
  return {
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri,
    scopes: process.env.OIDC_SCOPES?.trim() || "openid email profile",
    roleClaim: process.env.OIDC_ROLE_CLAIM?.trim() || null,
    adminValues: (process.env.OIDC_ADMIN_VALUES ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    appsClaim: process.env.OIDC_APPS_CLAIM?.trim() || null,
  };
}

export const isOidcEnabled = (): boolean => oidcConfig() !== null;

// --- PKCE (RFC 7636) + état/nonce -------------------------------------------
const b64url = (b: Buffer): string =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** code_verifier aléatoire + code_challenge = base64url(sha256(verifier)) (S256). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Jeton opaque aléatoire (state / nonce). */
export const randomToken = (): string => b64url(randomBytes(24));

export const discoveryUrl = (issuer: string): string =>
  `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;

/** Construit l'URL d'autorisation OIDC (redirection navigateur vers l'IdP). */
export function buildAuthorizeUrl(
  authorizationEndpoint: string,
  p: { clientId: string; redirectUri: string; scope: string; state: string; nonce: string; codeChallenge: string },
): string {
  const u = new URL(authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", p.scope);
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// --- mapping claims -> utilisateur console ----------------------------------
export interface MappedUser {
  email: string;
  role: "admin" | "viewer" | null; // null = pas de claim de rôle -> ne pas écraser
  apps: string[] | null;
  appsProvided: boolean; // le claim apps était présent -> apps fait autorité
}

function claimToArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

/**
 * Mappe les claims de l'ID token vers un utilisateur console. Lève si aucun email.
 * - rôle : si `roleClaim` configuré → admin si une valeur ∈ adminValues, sinon viewer ;
 *   sinon null (le rôle géré dans la console est préservé).
 * - apps : si `appsClaim` configuré → liste (viewer scopé) ; sinon non fourni.
 */
export function mapClaims(claims: Record<string, unknown>, cfg: OidcConfig): MappedUser {
  const email = (
    (typeof claims.email === "string" && claims.email) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    ""
  ).trim().toLowerCase();
  if (!email) throw new Error("ID token sans email/preferred_username");

  let role: "admin" | "viewer" | null = null;
  if (cfg.roleClaim) {
    const vals = claimToArray(claims[cfg.roleClaim]);
    role = vals.some((v) => cfg.adminValues.includes(v)) ? "admin" : "viewer";
  }

  let apps: string[] | null = null;
  let appsProvided = false;
  if (cfg.appsClaim && cfg.appsClaim in claims) {
    apps = claimToArray(claims[cfg.appsClaim]);
    appsProvided = true;
  }
  return { email, role, apps, appsProvided };
}
