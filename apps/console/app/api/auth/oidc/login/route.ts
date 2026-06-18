// GET /api/auth/oidc/login — démarre le flux OIDC : PKCE + state + nonce stockés
// en cookies httpOnly courts, puis redirection vers l'IdP. 404 si SSO non configuré.
import { type NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, generatePkce, oidcConfig, randomToken } from "@/lib/oidc";
import { discover } from "@/lib/oidc-remote";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.json({ error: "SSO non configuré" }, { status: 404 });

  let meta;
  try {
    meta = await discover(cfg.issuer);
  } catch (e) {
    console.error("[oidc/login]", e);
    return NextResponse.redirect(new URL("/login?error=1", _req.url), 302);
  }

  const { verifier, challenge } = generatePkce();
  const state = randomToken();
  const nonce = randomToken();
  const url = buildAuthorizeUrl(meta.authorization_endpoint, {
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    scope: cfg.scopes,
    state,
    nonce,
    codeChallenge: challenge,
  });

  const res = NextResponse.redirect(url, 302);
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 min pour boucler l'aller-retour IdP
  };
  res.cookies.set("oidc_state", state, opts);
  res.cookies.set("oidc_verifier", verifier, opts);
  res.cookies.set("oidc_nonce", nonce, opts);
  return res;
}
