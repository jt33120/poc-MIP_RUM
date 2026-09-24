// `apps/console/lib/auth.ts` DANS LE SERVICE `api` : aucune session, jamais.
//
// La console vérifie ses cookies de session avec `AUTH_SECRET` (JWT). L'API
// publique n'en a pas besoin et ne doit pas pouvoir en avoir : un cookie de
// console ne vaut rien ici (401), et le secret des sessions ne quitte pas la
// console. Le build remplace le module ENTIER par celui-ci et vérifie, dans le
// métafichier, que le vrai `lib/auth.ts` (et `jose`) n'y sont pas.
//
// Les importeurs du graphe v1 n'en utilisent que ceci : le nom du cookie (qu'ils
// lisent sur la requête, où il n'y en a jamais), `verifyJwt` et `principalDeJeton`,
// qui ne reconnaissent rien.
export const SESSION_COOKIE = "mip_session";

/** Aucune session n'est jamais valide dans l'API publique. */
export async function verifyJwt() {
  return null;
}

/** Aucune session, quel que soit son format (HS256 de la console, ES256 de console-api). */
export async function principalDeJeton() {
  return null;
}

/** Aucun utilisateur connecté. */
export async function getUser() {
  return null;
}
