// La sonde « vivant » de la console, pour la supervision EXTERNE
// (`.github/workflows/sonde-externe.yml`) : même rôle que `/live` des services
// Railway (`packages/service-kit/http.mjs`).
//
// Elle ne touche JAMAIS la base, ni directement ni par un import qui ouvrirait le
// pool : une sonde externe qui fait un `select 1` à chaque passage empêche Neon de
// dormir — c'est ce qui a fait fondre le quota le 24/09/2026. `/api/ingest/v1/traces`
// en GET ne convient pas : son CORS lit le registre des applications.
// `tests/unit/sonde-externe.test.ts` refuse tout import dans ce fichier.

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
