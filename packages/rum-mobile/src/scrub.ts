// Scrub PORTABLE — variante pure du scrub d'ingestion, appliquée AVANT toute
// écriture durable de la file mobile.
//
// POURQUOI UNE SECONDE IMPLÉMENTATION. Le scrub serveur
// (`apps/ingest/supabase/functions/_shared/scrub.mjs`) reste obligatoire et
// autoritaire à réception : il n'est pas remplacé ici. Mais entre le moment où
// un événement est mis en file et celui où il part, il peut dormir 24 h sur le
// disque d'un téléphone — un support que nous ne contrôlons pas, que l'OS
// sauvegarde parfois dans le cloud, et dont le contenu survit à la
// désinstallation sur certaines plateformes. `beforeSend` seul n'est PAS une
// garantie de confidentialité du disque : c'est un hook applicatif, facultatif,
// et souvent mal configuré. On nettoie donc avant d'écrire.
//
// Le module est volontairement une TRANSPOSITION LIGNE À LIGNE du scrub
// serveur : mêmes motifs, même ordre de passes, mêmes jetons de remplacement.
// `tests/unit/rum-mobile-scrub-portable.test.ts` rejoue sur lui le corpus du
// scrub serveur, pour qu'une divergence devienne un échec de test et non une
// fuite silencieuse.
//
// Il n'est pas dans `@mip/rum-core` : un seul runtime écrit sur un disque qu'il
// ne contrôle pas. Le jour où un second le fera, l'extraction sera justifiée.

// --- motifs (l'ordre d'application est défini dans scrubText) ----------------

const RE_SECRET_KV =
  /\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|sid)\b(\s*[:=]\s*|"\s*:\s*"?)([^\s,;"'&)}]+)/gi;
const RE_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const RE_BASIC = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi;
// Ancré sur « eyJ » (base64url de `{"`) pour ne pas avaler les identifiants
// pointés d'une stack, qui ont eux aussi trois segments séparés par des points.
const RE_JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const RE_PREFIXED_KEY = /\b(?:sk|pk|rk|ghp|gho|xox[abpr])[-_][A-Za-z0-9]{8,}\b/gi;
const RE_MIP_KEY = /\bmip_[A-Za-z0-9]{8,}\b/gi;
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// ≥ 9 chiffres : épargne les codes d'erreur et les petits identifiants, attrape
// cartes, téléphones et numéros de compte, séparateurs compris.
const RE_LONG_NUM = /\b\d(?:[ -]?\d){8,}\b/g;

/** Texte libre (message, stack, libellé). Conservateur : masque, ne tronque pas. */
export function scrubText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return input
    .replace(RE_SECRET_KV, (_m, key: string, sep: string) => `${key}${sep}[redacted]`)
    .replace(RE_BEARER, "Bearer [redacted]")
    .replace(RE_BASIC, "Basic [redacted]")
    .replace(RE_JWT, "[jwt]")
    .replace(RE_PREFIXED_KEY, "[key]")
    .replace(RE_MIP_KEY, "[key]")
    .replace(RE_EMAIL, "[email]")
    .replace(RE_IPV4, "[ip]")
    .replace(RE_LONG_NUM, "[number]");
}

/**
 * URL : query et fragment retirés (c'est là que vivent les jetons), puis
 * secrets et emails masqués dans le chemin. On ne touche ni aux longues suites
 * de chiffres ni aux IP d'une URL : un identifiant numérique de chemin reste
 * utile au diagnostic et n'identifie personne.
 */
export function scrubUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const base = url.split("?")[0].split("#")[0];
  return base
    .replace(RE_SECRET_KV, (_m, key: string, sep: string) => `${key}${sep}[redacted]`)
    .replace(RE_JWT, "[jwt]")
    .replace(RE_PREFIXED_KEY, "[key]")
    .replace(RE_MIP_KEY, "[key]")
    .replace(RE_EMAIL, "[email]");
}

/** Clés dont la VALEUR entière est masquée, quel que soit son contenu. */
const SECRET_KEY = /pass(?:word|wd)?|pwd|secret|token|api[_-]?key|auth|bearer|email|e[_-]?mail|phone|ssn|credit|card|cvv|iban/i;

/** Objet de props défini par l'application : récursif, borné en profondeur. */
export function scrubProps(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubProps(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrubProps(v, depth + 1);
    }
    return out;
  }
  return value; // nombre / booléen : non identifiant, conservé tel quel
}

/**
 * Attributs qui portent une URL. Elles passent par `scrubUrl` et non par
 * `scrubText` : retirer la query d'une URL est utile, masquer ses identifiants
 * numériques ne l'est pas.
 */
const ATTRS_URL = new Set(["http.url", "mip.url", "mip.error_source", "mip.referrer"]);

/** Attributs qui portent du JSON applicatif — à nettoyer clé par clé. */
const ATTRS_JSON = new Set(["mip.props", "mip.context"]);

/**
 * Attributs RETIRÉS avant toute écriture durable.
 *
 * Les identifiants métier bruts ont le droit de vivre en mémoire et de
 * transiter vers l'endpoint MIP, qui seul détient le secret HMAC app-scopé. Ils
 * n'ont PAS le droit de dormir sur un disque. Conséquence assumée et
 * documentée : un événement restauré au prochain lancement n'est rattaché à une
 * identité que si le serveur connaît déjà sa session d'origine. On ne le
 * rattache jamais à l'utilisateur courant — ce serait inventer une vérité.
 */
const ATTRS_INTERDITS = new Set([
  "mip.identity.user_id",
  "mip.identity.account_id",
  "mip.api_key",
]);

/**
 * Nettoie les attributs d'UN span avant écriture durable. Rend un objet neuf :
 * l'événement encore en mémoire, lui, garde ses identités pour l'envoi direct.
 */
export function scrubAttributesPourDisque(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (ATTRS_INTERDITS.has(key)) continue;
    if (value == null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;
    if (ATTRS_URL.has(key)) {
      out[key] = scrubUrl(value);
      continue;
    }
    if (ATTRS_JSON.has(key)) {
      out[key] = scrubJsonAttribut(value);
      continue;
    }
    out[key] = scrubText(value);
  }
  return out;
}

/**
 * Un attribut JSON est nettoyé STRUCTURELLEMENT : `{"email":"a@b.fr"}` doit
 * devenir `{"email":"[redacted]"}`, pas `{"email":"[email]"}`. Le nom de la clef
 * porte l'information de sensibilité ; l'appliquer en texte plat la perdrait.
 * Si le JSON est illisible, on retombe sur le nettoyage texte plutôt que de
 * laisser passer la chaîne brute.
 */
function scrubJsonAttribut(raw: string): string {
  try {
    const nettoye = scrubProps(JSON.parse(raw));
    return JSON.stringify(nettoye) ?? "{}";
  } catch {
    return scrubText(raw) ?? "";
  }
}
