import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyJwt } from "@/lib/auth";

// Auth v0.3 (B3) : JWT cookie httpOnly signé AUTH_SECRET — remplace le basic auth v0.2.
// PUBLICS sans auth (matcher) : /login, /mip-rum.js, /mip-rum-replay.js, /_next/*, /favicon*.
// Le SDK reste TOUJOURS public (snippet chargé par les sites clients).
export async function middleware(req: NextRequest) {
  // API publique v1 (LOT C option B) : authentifiée par jeton (Authorization: Bearer)
  // OU cookie, DANS le handler — le middleware ne doit pas la rediriger vers /login
  // (le front Angular MIP appelle sans cookie de session).
  if (req.nextUrl.pathname.startsWith("/api/v1")) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyJwt(token) : null;
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 302);

  // Scoping viewer au niveau requête : app demandée hors scope (ou « toutes »)
  // -> fallback 1re app autorisée. GET pages uniquement (pas de redirect sur les
  // POST de server actions ni sur les routes API, gérées côté données).
  if (
    req.method === "GET" &&
    !req.nextUrl.pathname.startsWith("/api/") &&
    user.role === "viewer" &&
    user.apps?.length
  ) {
    const requested = req.nextUrl.searchParams.get("app");
    if (!requested || !user.apps.includes(requested)) {
      const url = req.nextUrl.clone();
      url.searchParams.set("app", user.apps[0]);
      return NextResponse.redirect(url, 302);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|mip-rum|_next/|favicon).*)"],
};
