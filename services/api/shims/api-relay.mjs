// `apps/console/lib/api-relay.ts` DANS LE SERVICE `api`.
//
// Le relais (#292) envoie les lectures au jeton de la CONSOLE vers ce service.
// Ici, il n'a pas de sens : le service est la cible, et relayer serait se
// rappeler lui-même (d'où le refus de démarrer avec `CONSOLE_API_RELAY_URL`).
// Sans ce remplaçant, le bundle embarquait le relais ET sa lecture du drapeau
// (`platform_flag`) — une table que le rôle `mip_api` n'a aucune raison de lire,
// et que la garde des droits (`scripts/ci/verify-db-roles.mjs`) refuse.

/** Aucune lecture n'est relayée depuis le service qui les sert. */
export async function relayerLectureApi() {
  return null;
}
