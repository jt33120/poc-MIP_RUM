import { NextResponse, type NextRequest } from "next/server";

// Basic auth optionnelle : env BASIC_AUTH="user:pass" (limite n°18).
// Sans env -> pas d'auth (dev local). Le SDK /mip-rum.js reste TOUJOURS public
// (snippet chargé par les sites clients), assets Next et favicon aussi.
export function middleware(req: NextRequest) {
  const expected = process.env.BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const got = req.headers.get("authorization");
  if (got === `Basic ${btoa(expected)}`) return NextResponse.next();

  return new NextResponse("Authentification requise.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="MIP RUM", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!mip-rum\\.js|_next/|favicon).*)"],
};
