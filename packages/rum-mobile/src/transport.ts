// Transport mobile : un lot n'est retiré de la file qu'après ACQUITTEMENT.
//
// CE QUE P7.1 FAISAIT, ET POURQUOI ÇA NE SUFFIT PAS. `flush()` retirait le
// tampon AVANT l'envoi (`buffer.splice`) et absorbait l'échec. Un tunnel, un
// avion, un serveur en incident : les événements étaient perdus sans trace,
// et `getDiagnostics()` ne pouvait rien en dire. Ici, le retrait suit la
// réponse.
//
// CE QUI MÉRITE D'ÊTRE REJOUÉ. Un 429 ou un 503 disent « plus tard » ; un 401
// ou un 400 disent « non ». Rejouer un « non » indéfiniment, c'est vider la
// batterie de l'utilisateur pour une clef d'API mal saisie — et remplir la file
// d'un lot condamné, au détriment d'événements qui, eux, passeraient.
//
// LE BRUIT N'EST PAS UN ORNEMENT. Sans lui, tous les téléphones qui ont échoué
// pendant un incident reviennent à la même seconde : le retour de service reçoit
// un pic supérieur au trafic nominal, et l'incident se reproduit tout seul.

/** Statuts qu'il est utile de retenter : le serveur dit « plus tard », pas « non ». */
const REJOUABLES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Premier palier du retrait. Court : un mobile reprend souvent le réseau vite. */
export const RETRY_BASE_MS = 1_000;
/** Plafond du retrait exponentiel. */
export const RETRY_MAX_MS = 5 * 60_000;
/**
 * Plafond de `Retry-After`. Un serveur mal configuré peut annoncer 24 h ; on
 * ne laisse pas une en-tête décider d'un silence d'une journée, mais on
 * n'abrège jamais un délai plus court que le nôtre.
 */
export const RETRY_AFTER_MAX_MS = 15 * 60_000;
/**
 * Taille maximale du corps HTTP réellement acceptée par l'ingestion
 * (`MAX_BODY_BYTES`, packages/backend/.../limits.mjs). Le lot est mesuré APRÈS
 * encodage OTLP, parce que l'encodage multiplie la taille des attributs par
 * deux à trois : un plafond appliqué à la forme aplatie serait une estimation,
 * pas le plafond réel.
 */
export const HTTP_MAX_BODY_BYTES = 2_000_000;

export interface Classement {
  /** Le serveur a-t-il accusé réception ? Seul `true` autorise le retrait. */
  acquitte: boolean;
  /** Vaut-il la peine de réessayer ? */
  rejouable: boolean;
}

/**
 * Classe une réponse HTTP. PURE, donc testable sans réseau.
 *
 * `null` = aucune réponse (réseau coupé) : c'est le cas nominal du mode hors
 * ligne, celui pour lequel cette file existe. Rejouable, évidemment.
 */
export function classerReponse(status: number | null): Classement {
  if (status == null) return { acquitte: false, rejouable: true };
  if (status >= 200 && status < 300) return { acquitte: true, rejouable: false };
  if (REJOUABLES.has(status)) return { acquitte: false, rejouable: true };
  if (status >= 500) return { acquitte: false, rejouable: true };
  // 4xx : la requête est en tort. La rejouer ne l'améliore pas.
  return { acquitte: false, rejouable: false };
}

/**
 * Lit `Retry-After` (secondes ou date HTTP). Rend `null` si absent ou
 * illisible, jamais une valeur négative, jamais plus que le plafond.
 */
export function lireRetryAfter(valeur: string | null | undefined, maintenant: number): number | null {
  if (!valeur) return null;
  const secondes = Number(String(valeur).trim());
  if (Number.isFinite(secondes)) {
    return secondes > 0 ? Math.min(Math.round(secondes * 1000), RETRY_AFTER_MAX_MS) : null;
  }
  const date = Date.parse(String(valeur));
  if (!Number.isFinite(date)) return null;
  const delta = date - maintenant;
  return delta > 0 ? Math.min(delta, RETRY_AFTER_MAX_MS) : null;
}

/**
 * Délai avant la prochaine tentative, avec bruit.
 *
 * Quand le serveur a dit `Retry-After`, le bruit ne fait que DISPERSER le
 * retour : il n'abrège jamais l'attente demandée.
 */
export function delaiProchainEssai(tentatives: number, retryAfterMs: number | null, alea: number): number {
  if (retryAfterMs != null && retryAfterMs > 0) return Math.round(retryAfterMs * (1 + alea * 0.5));
  const expo = Math.min(RETRY_BASE_MS * 2 ** Math.min(Math.max(tentatives, 1) - 1, 12), RETRY_MAX_MS);
  return Math.round(expo * (0.5 + alea));
}

export interface ReponseEnvoi {
  status: number | null;
  retryAfterMs: number | null;
  /** Corps trop volumineux : à découper, pas à rejouer tel quel. */
  tropGros: boolean;
}

/** Lecture tolérante d'une en-tête, quelle que soit la forme de l'objet Headers. */
function entete(reponse: unknown, nom: string): string | null {
  const headers = (reponse as { headers?: { get?: (k: string) => string | null } } | null)?.headers;
  if (typeof headers?.get !== "function") return null;
  try {
    return headers.get(nom);
  } catch {
    return null;
  }
}

/**
 * Envoie un corps déjà sérialisé et rend la réponse BRUTE (statut + en-tête),
 * sans jamais lever. Le corps de la réponse n'est pas lu : il peut contenir un
 * écho de la charge envoyée, donc de la donnée applicative, et un diagnostic
 * n'a pas à la recopier.
 */
export async function envoyer(
  fetchImpl: (url: string, init: Record<string, unknown>) => Promise<{ status: number; headers?: unknown }>,
  url: string,
  corps: string,
  entetes: Record<string, string>,
  signal?: unknown,
  maintenant: number = Date.now(),
): Promise<ReponseEnvoi> {
  if (octetsCorps(corps) > HTTP_MAX_BODY_BYTES) {
    return { status: null, retryAfterMs: null, tropGros: true };
  }
  try {
    const reponse = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...entetes },
      body: corps,
      ...(signal ? { signal } : {}),
    });
    const status = typeof reponse?.status === "number" ? reponse.status : null;
    return {
      status,
      retryAfterMs: lireRetryAfter(entete(reponse, "retry-after"), maintenant),
      tropGros: status === 413,
    };
  } catch {
    // Pas de réponse du tout : réseau coupé, DNS, TLS, abandon. On ne
    // journalise pas le message — il peut contenir l'URL complète et ses
    // paramètres.
    return { status: null, retryAfterMs: null, tropGros: false };
  }
}

function octetsCorps(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return value.length;
}
