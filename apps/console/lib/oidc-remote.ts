// OIDC — partie réseau (discovery + échange de code). Isolée du cœur testable
// (lib/oidc.ts). Utilisée par les route handlers /api/auth/oidc/*.
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { OidcConfig } from "./oidc";
import { discoveryUrl } from "./oidc";

export interface OidcMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

// cache mémoire (survit au hot-reload, TTL 10 min) — la discovery change rarement.
const g = globalThis as unknown as { oidcMeta?: { at: number; meta: OidcMeta } };

export async function discover(issuer: string): Promise<OidcMeta> {
  if (g.oidcMeta && Date.now() - g.oidcMeta.at < 600_000) return g.oidcMeta.meta;
  const res = await fetch(discoveryUrl(issuer));
  if (!res.ok) throw new Error(`OIDC discovery ${res.status}`);
  const meta = (await res.json()) as OidcMeta;
  if (!meta.authorization_endpoint || !meta.token_endpoint || !meta.jwks_uri)
    throw new Error("OIDC discovery incomplète");
  g.oidcMeta = { at: Date.now(), meta };
  return meta;
}

/** Échange le code d'autorisation contre les jetons (id_token). */
export async function exchangeCode(
  meta: OidcMeta,
  cfg: OidcConfig,
  code: string,
  codeVerifier: string,
): Promise<{ id_token: string; access_token?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OIDC token ${res.status}: ${detail.slice(0, 200)}`);
  }
  const tok = (await res.json()) as { id_token?: string; access_token?: string };
  if (!tok.id_token) throw new Error("OIDC: id_token absent");
  return { id_token: tok.id_token, access_token: tok.access_token };
}

/** JWKS distant (mis en cache par jose lui-même). */
export const remoteJwks = (jwksUri: string) => createRemoteJWKSet(new URL(jwksUri));

/**
 * Valide l'ID token : signature (via JWKS distant), issuer, audience (clientId),
 * puis nonce. Retourne les claims.
 */
export async function verifyIdToken(
  idToken: string,
  jwks: ReturnType<typeof createRemoteJWKSet>,
  opts: { issuer: string; clientId: string; nonce: string },
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: opts.issuer,
    audience: opts.clientId,
  });
  if (payload.nonce !== opts.nonce) throw new Error("nonce OIDC invalide");
  return payload as Record<string, unknown>;
}
