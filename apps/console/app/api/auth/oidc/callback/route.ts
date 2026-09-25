// GET /api/auth/oidc/callback — retour de l'IdP : vérifie state, échange le code,
// valide l'ID token, mappe les claims → rôle/apps, PROVISIONNE en JIT le
// console_user, ouvre la session (cookie JWT). Erreur → /login?error=1.
import { type NextRequest, NextResponse } from "next/server";
import { FIN_SSO } from "@mip/console-contract";
import { SESSION_COOKIE, SESSION_HOURS, signJwt } from "@/lib/auth";
import { backend } from "@/lib/backend";
import { q } from "@/lib/db";
import { COOKIE_TRANSACTION_SSO, mapClaims, oidcConfig } from "@/lib/oidc";
import { discover, exchangeCode, remoteJwks, verifyIdToken } from "@/lib/oidc-remote";

export const dynamic = "force-dynamic";

function fail(req: NextRequest, e: unknown): NextResponse {
  console.error("[oidc/callback]", e);
  const res = NextResponse.redirect(new URL("/login?error=1", req.url), 302);
  for (const c of ["oidc_state", "oidc_verifier", "oidc_nonce"]) res.cookies.delete(c);
  return res;
}

/**
 * C1c — le retour de l'IdP, branché sur console-api : le service échange le code
 * (avec le secret client OIDC qu'il est seul à détenir), vérifie l'ID token et
 * lie le compte par (émetteur, sujet). Tout refus rend le même `?error=1` ; la
 * raison est au journal d'audit du service.
 */
async function retourParConsoleApi(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const echec = () => {
    const res = NextResponse.redirect(new URL("/login?error=1", req.url), 302);
    res.cookies.set(COOKIE_TRANSACTION_SSO, "", { path: "/api/auth/oidc", maxAge: 0 });
    return res;
  };
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const transaction = req.cookies.get(COOKIE_TRANSACTION_SSO)?.value;
  if (url.searchParams.get("error") || !code || !state || !transaction) return echec();
  const r = await backend().appeler(FIN_SSO, { corps: { code, state, transaction } }, { requestId: req.headers.get("x-request-id") ?? undefined });
  if (!r.ok) return echec();
  const res = NextResponse.redirect(new URL("/", req.url), 302);
  res.cookies.set(SESSION_COOKIE, r.data.jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(r.data.expire_le),
  });
  res.cookies.set(COOKIE_TRANSACTION_SSO, "", { path: "/api/auth/oidc", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  if (backend().estBranche()) return retourParConsoleApi(req);
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.json({ error: "SSO non configuré" }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return fail(req, url.searchParams.get("error"));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("oidc_state")?.value;
  const verifier = req.cookies.get("oidc_verifier")?.value;
  const nonce = req.cookies.get("oidc_nonce")?.value;

  // anti-CSRF : le state DOIT correspondre au cookie posé au login
  if (!code || !state || !cookieState || state !== cookieState || !verifier || !nonce)
    return fail(req, "state/PKCE manquant ou invalide");

  try {
    const meta = await discover(cfg.issuer);
    const { id_token } = await exchangeCode(meta, cfg, code, verifier);
    const claims = await verifyIdToken(id_token, remoteJwks(meta.jwks_uri), {
      issuer: meta.issuer,
      clientId: cfg.clientId,
      nonce,
    });
    const mapped = mapClaims(claims, cfg);

    // provisioning JIT : le rôle/apps de l'IdP font autorité s'ils sont fournis,
    // sinon on préserve ce qui est géré dans la console (1re connexion → viewer).
    const [existing] = await q<{ role: "admin" | "viewer"; apps: string[] | null }>(
      `select role, apps from console_user where email = $1`,
      [mapped.email],
    );
    const role = mapped.role ?? existing?.role ?? "viewer";
    const apps = mapped.appsProvided ? mapped.apps : (existing?.apps ?? null);

    // password_hash sentinelle 'sso:oidc' → bcrypt.compare échoue toujours
    // (connexion par mot de passe impossible pour un compte SSO).
    await q(
      `insert into console_user (email, password_hash, role, apps, active, last_login_at)
       values ($1, 'sso:oidc', $2, $3, true, now())
       on conflict (email) do update
         set role = $2, apps = $3, active = true, last_login_at = now()`,
      [mapped.email, role, apps],
    );
    await q(`insert into audit_log (user_email, action, detail) values ($1, 'login', $2)`, [
      mapped.email,
      JSON.stringify({ method: "sso", provider: cfg.issuer }),
    ]);

    const token = await signJwt({ email: mapped.email, role, apps });
    const res = NextResponse.redirect(new URL("/", req.url), 302);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_HOURS * 3600,
    });
    for (const c of ["oidc_state", "oidc_verifier", "oidc_nonce"]) res.cookies.delete(c);
    return res;
  } catch (e) {
    return fail(req, e);
  }
}
