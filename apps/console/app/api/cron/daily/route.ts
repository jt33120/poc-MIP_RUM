// Tick quotidien (purge de rétention, métrage) — ROUTE RETIRÉE (23/09/2026).
//
// POURQUOI 410 PLUTÔT QU'UNE SUPPRESSION. Trois déclencheurs lançaient le même
// travail : le service `scheduler` sur Railway, un cron GitHub Actions et Vercel
// Cron. Ces routes-ci, contrairement au scheduler, ne prenaient AUCUN bail : aux
// minutes où deux déclencheurs se croisaient, la cadence tournait deux fois. Les
// étapes qui lisent puis insèrent sans verrou — bascule de SLO, anomalies IA,
// sondes uptime — pouvaient produire deux événements d'alerte et sonder deux fois
// la même URL. Le commentaire de `lib/cron.ts` affirmait l'inverse ; il était faux.
//
// Le déclencheur unique est désormais le service `scheduler`, qui prend un bail
// par cadence (`packages/backend/jobs/bail.mjs`). Pour rejouer une cadence à la main :
//   railway run --service scheduler node services/scheduler/run-once.mjs daily
//
// La route répond 410 au lieu de disparaître : un appelant resté branché — un cron
// oublié, un moniteur — reçoit une réponse qui DIT ce qui s'est passé, là où un 404
// se lirait comme une panne. Elle disparaîtra avec `lib/cron.ts`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(
    {
      error: "route retirée",
      raison:
        "les travaux planifiés sont déclenchés par le service scheduler (Railway), qui prend un bail par cadence ; cette route ne le faisait pas et provoquait des exécutions en double",
      remplacement: "railway run --service scheduler node services/scheduler/run-once.mjs daily",
    },
    { status: 410 },
  );
}
