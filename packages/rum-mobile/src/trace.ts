// Propagation de trace — origines autorisées et en-tête `traceparent`.
//
// POURQUOI UN MODULE À PART. Ce sont les seules décisions du patch `fetch` qui
// se raisonnent sans réseau : « dois-je propager vers cette origine ? » et
// « cet en-tête est-il un traceparent valide ? ». Les isoler ici les rend
// testables une par une, au lieu de ne les observer qu'à travers un appel HTTP
// simulé.
//
// POURQUOI LA LISTE EST DÉSORMAIS FERMÉE. Jusqu'à P7.2, `traceOrigins: []`
// voulait dire « toutes les origines sauf l'endpoint ». Un `traceparent` et un
// `tracestate` portant l'identifiant de session partaient donc vers n'importe
// quel tiers appelé par l'application — régie publicitaire, service de cartes,
// passerelle de paiement. Ces en-têtes sont de la donnée de session : ils lient
// l'appel du tiers à la visite en cours. Le défaut est maintenant l'inverse :
// on ne propage QUE vers ce que l'application a nommé.

/**
 * `traceparent` W3C, version 00.
 *
 * Les identifiants tout-à-zéro sont refusés par la spécification, et
 * l'ingestion MIP les refuse aussi (`nativeTraceId`). Un en-tête mal formé n'est
 * donc pas « un traceparent qu'on préserve » : c'est un en-tête qu'on remplace.
 */
const TRACEPARENT =
  /^00-(?!0{32}-)([0-9a-f]{32})-(?!0{16}-)([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Longueur maximale d'un `tracestate` que l'on accepte de rallonger. */
const TRACESTATE_MAX = 512;

export interface TraceparentValide {
  traceId: string;
  /** `parent-id` W3C : l'identifiant du span CLIENT, donc celui de notre span. */
  spanId: string;
  flags: string;
}

/**
 * Analyse un `traceparent` reçu. Rend `null` dès qu'il n'est pas exactement
 * conforme — un en-tête approximatif corrélé à tort vaut moins qu'une trace
 * neuve, parce qu'il fabrique un lien vers une trace qui n'existe pas.
 */
export function analyserTraceparent(valeur: unknown): TraceparentValide | null {
  if (typeof valeur !== "string") return null;
  const m = TRACEPARENT.exec(valeur.trim().toLowerCase());
  return m ? { traceId: m[1], spanId: m[2], flags: m[3] } : null;
}

/**
 * Origine d'une URL absolue (`schéma://hôte[:port]`), en minuscules.
 *
 * Volontairement sans `URL` : le constructeur n'est pas garanti sur tous les
 * moteurs JS visés, et une URL relative n'a de toute façon pas d'origine
 * observable depuis React Native, où il n'existe pas d'URL de base.
 */
export function normaliserOrigine(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url.trim());
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : null;
}

/**
 * Normalise la configuration `traceOrigins`. Une entrée qui n'est pas une
 * origine absolue est REFUSÉE et rendue à l'appelant : depuis que le défaut ne
 * propage plus rien, une entrée silencieusement ignorée équivaudrait à couper
 * la corrélation d'un client qui croit l'avoir demandée.
 */
export function resoudreTraceOrigins(valeurs: unknown): {
  origines: string[];
  refusees: string[];
} {
  const origines: string[] = [];
  const refusees: string[] = [];
  if (!Array.isArray(valeurs)) return { origines, refusees };
  for (const brute of valeurs) {
    const origine = normaliserOrigine(brute);
    if (!origine) {
      if (typeof brute === "string" && brute.trim()) refusees.push(brute.trim());
      continue;
    }
    if (!origines.includes(origine)) origines.push(origine);
  }
  return { origines, refusees };
}

/**
 * Faut-il propager le contexte de trace vers cette origine ?
 *
 * L'endpoint de collecte est exclu MÊME s'il figure dans `traceOrigins` : une
 * requête d'ingestion tracée produirait un span, qui produirait une requête
 * d'ingestion. La boucle est l'unique raison de cette exception.
 */
export function doitPropager(
  origine: string | null,
  traceOrigins: readonly string[],
  origineEndpoint: string,
): boolean {
  if (!origine || origine === origineEndpoint) return false;
  return traceOrigins.includes(origine);
}

/**
 * `tracestate` sortant : notre entrée en tête, celles du client conservées
 * derrière, le tout borné. L'ordre est celui du W3C — le dernier système à
 * avoir écrit passe en premier.
 */
export function composerTracestate(existant: unknown, sessionId: string): string {
  const notre = `mip=s:${sessionId}`;
  const precedent = typeof existant === "string" ? existant.trim() : "";
  if (!precedent) return notre;
  const compose = `${notre},${precedent}`;
  return compose.length <= TRACESTATE_MAX ? compose : notre;
}
