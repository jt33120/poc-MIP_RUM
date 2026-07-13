// GET /api/v1/docs — Swagger UI (HTML) rendant la spec publique /api/v1/openapi.
// 100 % auto-hébergé : le HTML ET les assets Swagger UI sont servis par la console
// (public/vendor/swagger/, vendorisés depuis swagger-ui-dist — cf.
// scripts/vendor-swagger.mjs). Aucun CDN tiers : la console est souveraine UE.
// Public comme la spec (le contrat n'est pas secret) — /api/v1/* est bypassé par
// le middleware d'auth.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MIP RUM — API v1 · Swagger UI</title>
    <link rel="stylesheet" href="/vendor/swagger/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/vendor/swagger/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          url: "/api/v1/openapi",
          dom_id: "#swagger-ui",
          deepLinking: true,
          docExpansion: "list",
          defaultModelsExpandDepth: 0,
        });
      });
    </script>
  </body>
</html>`;

export function GET() {
  return new NextResponse(HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
