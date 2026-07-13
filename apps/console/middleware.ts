import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyJwt } from "@/lib/auth";

// Auth v0.3 (B3) : JWT cookie httpOnly signé AUTH_SECRET — remplace le basic auth v0.2.
// PUBLICS sans auth (matcher) : /login, /mip-rum.js, /mip-rum-replay.js, /_next/*, /favicon*.
// Le SDK reste TOUJOURS public (snippet chargé par les sites clients).
export async function middleware(req: NextRequest) {
  // Flux SSO/OIDC : login + callback doivent s'exécuter SANS session (sinon
  // redirection /login en boucle). L'auth se fait dans le handler de callback.
  if (req.nextUrl.pathname.startsWith("/api/auth/")) return NextResponse.next();

  // /api/metrics : scrape Prometheus (sans cookie de session) — auth par token dans
  // le handler. Bypass de la redirection /login (sinon 302 au lieu des métriques).
  if (req.nextUrl.pathname === "/api/metrics") return NextResponse.next();
  // API publique v1 (LOT C option B) : authentifiée par jeton (Authorization: Bearer)
  // OU cookie, DANS le handler — le middleware ne doit pas la rediriger vers /login
  // (le front Angular MIP appelle sans cookie de session).
  if (req.nextUrl.pathname.startsWith("/api/v1")) return NextResponse.next();
  // API de lecture propriétaire (livrable UTI) : auth par token en base dans le
  // handler (Authorization: Bearer) — appel serveur-à-serveur sans cookie.
  if (req.nextUrl.pathname.startsWith("/api/rum")) return NextResponse.next();
  // Résolution domaine -> app_id pour l'extension navigateur (Ext-B) : appelée par
  // le service worker de l'extension (sans cookie), lecture seule, sans PII.
  if (req.nextUrl.pathname.startsWith("/api/extension")) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyJwt(token) : null;
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 302);

  // Porte « projet courant » : RUM et IA sont propres à UNE app, il n'y a pas de
  // vue « toutes les apps ». On réconcilie cookie de projet et paramètre ?app sur
  // les GET de pages (jamais les POST de server actions ni les routes API) :
  //   - ?app présent et dans le scope         -> on laisse passer ;
  //   - sinon, on retombe sur le cookie        -> redirect en injectant ?app ;
  //   - aucun projet résoluble                 -> redirect vers /select (picker).
  // /admin/* est trans-projet (gestion clients/users/audit) : pas de scope app,
  // donc pas de porte projet. /select est la porte elle-même.
  const { pathname } = req.nextUrl;
  // Le layout serveur ne reçoit pas le pathname : on le lui passe par en-tête pour
  // qu'il rende /select en plein écran (sans la coquille sidebar).
  const pass = () => {
    const h = new Headers(req.headers);
    h.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: h } });
  };

  const gated =
    req.method === "GET" &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/admin") &&
    pathname !== "/select" &&
    !pathname.startsWith("/select/");
  if (gated) {
    const requested = req.nextUrl.searchParams.get("app");
    const cookieApp = req.cookies.get("mip-project")?.value ?? null; // cf. lib/project.ts
    const scope = user.role === "viewer" && user.apps?.length ? user.apps : null;

    let eff = requested;
    if (scope && (!eff || !scope.includes(eff))) eff = null;
    if (!eff) {
      if (cookieApp && (!scope || scope.includes(cookieApp))) eff = cookieApp;
      else if (scope && scope.length === 1) eff = scope[0]; // viewer mono-app : pas de picker
    }

    if (!eff) return NextResponse.redirect(new URL("/select", req.url), 302);
    if (requested !== eff) {
      const url = req.nextUrl.clone();
      url.searchParams.set("app", eff);
      return NextResponse.redirect(url, 302);
    }
    // ?app résolu et dans le scope : on laisse passer, en gardant le cookie de
    // projet aligné sur l'URL (deep-link partagé sans cookie -> on le pose).
    if (cookieApp !== eff) {
      const res = pass();
      res.cookies.set("mip-project", eff, { path: "/", sameSite: "lax", maxAge: 180 * 24 * 3600 });
      return res;
    }
  }
  return pass();
}

export const config = {
  // `vendor` = assets tiers auto-hébergés (Swagger UI) servis depuis public/ —
  // exclus de la porte d'auth, comme _next et le SDK public.
  matcher: ["/((?!login|mip-rum|_next/|favicon|vendor).*)"],
};
