// GET /api/v1/docs — Swagger UI (HTML) rendant la spec publique /api/v1/openapi.
// Auto-hébergé : le HTML est servi par la console, seuls les assets Swagger UI
// viennent d'un CDN épinglé. Public comme la spec (le contrat n'est pas secret) —
// /api/v1/* est bypassé par le middleware d'auth.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Version épinglée (évite toute dérive du CDN).
const SWAGGER_VERSION = "5.17.14";

const HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MIP RUM — API v1 · Swagger UI</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
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
