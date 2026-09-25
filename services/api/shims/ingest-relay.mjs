// `apps/console/lib/ingest-relay.ts` DANS LE SERVICE `api`.
//
// Depuis C11, la route `POST /api/v1/deploys` de la console relaie le marqueur
// d'une CI vers le collector. Le service `api` embarque toutes les routes de
// l'API v1 mais n'en sert AUCUNE écriture (405, par construction) : le relais
// n'y a rien à faire, et il tirerait avec lui sa lecture de `platform_flag`, que
// `mip_api` n'a pas à lire (même raison que `api-relay.mjs`).

/** Aucune requête n'est relayée depuis le service de lecture. */
export async function relayer() {
  return null;
}

/** Aucune décision de relais non plus. */
export async function choisirRelais() {
  return null;
}
