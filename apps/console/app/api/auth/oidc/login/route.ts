// GET /api/auth/oidc/login — démarre le flux OIDC : PKCE + state + nonce stockés
// en cookies httpOnly courts, puis redirection vers l'IdP. 404 si SSO non configuré.
import { type NextRequest, NextResponse } from "next/server";
import { DEBUT_SSO } from "@mip/console-contract";
import { backend } from "@/lib/backend";
import { buildAuthorizeUrl, COOKIE_TRANSACTION_SSO, generatePkce, oidcConfig, randomToken } from "@/lib/oidc";
import { discover } from "@/lib/oidc-remote";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  // C1c — branchée sur console-api, c'est LUI qui démarre le SSO : découverte à
  // l'émetteur épinglé, PKCE, état et nonce SCELLÉS dans une transaction (JWE)
  // que la console garde en cookie sans pouvoir la lire. Le secret client OIDC
  // n'est plus ici.
  if (backend().estBranche()) {
    const r = await backend().appeler(DEBUT_SSO, {}, { requestId: _req.headers.get("x-request-id") ?? undefined });
    if (!r.ok) return NextResponse.redirect(new URL("/login?error=1", _req.url), 302);
    const res = NextResponse.redirect(r.data.url, 302);
    res.cookies.set(COOKIE_TRANSACTION_SSO, r.data.transaction, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/oidc",
      maxAge: 600,
    });
    return res;
  }

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
