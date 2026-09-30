// Ce que partagent les deux façons de joindre le service `api` depuis la console :
// le relais à pourcentage des routes historiques (`lib/api-relay.ts`, qui lit son
// drapeau en base) et la transmission des routes servies par le service SEUL
// (`lib/api/service-seul.ts`, qui ne lit rien). PUR : ni base, ni drapeau — sans
// quoi une route qui ne fait que transmettre atteindrait la base par son import
// (cliquet C-R, `tests/unit/inventaire-console.test.ts`).

/** L'en-tête qui signe une réponse du service (posé par le kit, jusque sur ses 404). */
export const ENTETE_API = "x-mip-api";
/** Ce qui est transmis, et rien d'autre : ni cookie, ni adresse du client. */
export const ENTETES_TRANSMIS = Object.freeze([
  "authorization",
  "accept",
  "content-type",
  "if-none-match",
  "origin",
  "x-request-id",
] as const);
export const DELAIS = Object.freeze({ reponseMs: 8_000, fenetreEchecsMs: 30_000, echecsMax: 5, coupureMs: 60_000 });
/** En-têtes de la réponse qui ne se recopient pas : `fetch` a déjà décodé le corps. */
export const NON_RECOPIES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** L'URL du service `api`, ou `null` (relais éteint). */
export function lireUrlRelaisApi(env: Record<string, string | undefined>): string | null {
  const brute = env.CONSOLE_API_RELAY_URL?.trim();
  if (!brute) return null;
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return null;
  }
  // Le relais transmet le jeton du client : jamais en clair hors de la machine.
  if (url.protocol === "https:" || (url.protocol === "http:" && HOTES_LOCAUX.has(url.hostname))) {
    return url.origin;
  }
  return null;
}
