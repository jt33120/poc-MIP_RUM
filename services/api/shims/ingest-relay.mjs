// `apps/console/lib/ingest-relay.ts` DANS LE SERVICE `api`.
//
// La route `POST /api/v1/deploys` de la console relaie le marqueur d'une CI vers
// le collector. Le service `api` embarque toutes les routes de l'API v1 mais
// n'en sert AUCUNE écriture (405, par construction) : le relais n'y a rien à
// faire, et il tirerait avec lui le secret de bord, que `mip-api` n'a pas à
// porter (même raison que `api-relay.mjs`).

/**
 * Jamais atteint (les écritures sont refusées avant) ; s'il l'était, un 503
 * plutôt qu'une écriture : depuis C12, le relais rend toujours une réponse.
 */
export async function relayer() {
  return new Response(JSON.stringify({ error: "ingestion unavailable, retry", retry: true }), {
    status: 503,
    headers: { "content-type": "application/json", "retry-after": "5" },
  });
}
