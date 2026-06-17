// Scrub PII à l'ingestion — défense en profondeur (A2). Le SDK filtre déjà côté
// client (beforeSend + scrubUrl), mais on ne s'y fie PAS : un client peut mal
// configurer beforeSend, ou un middleware backend tiers (auto-instrumentation
// OTel) émettre des URL/messages bruts. On nettoie donc une seconde fois côté
// serveur, AVANT écriture en base, sur les champs libres (message, stack, url,
// referrer, source, props d'événements), front comme back.
//
// JS pur, sans dépendance : importé tel quel par le dev-server Node et l'edge
// function Deno (parité garantie via _shared/otlp.mjs). Logique pure -> testée
// unitairement (tests/unit/scrub.test.ts).
//
// Principe : conservateur. On remplace ce qui est presque sûrement un secret ou
// une donnée personnelle par un jeton lisible ([email], [redacted], [jwt]…), en
// gardant le reste du texte exploitable pour le diagnostic. L'ordre des passes
// compte (emails/jwt avant la redaction de longues suites de chiffres).

// --- motifs (l'ordre d'application est défini dans scrubText) ----------------

// Affectations clé=valeur sensibles : password, token, secret, api_key,
// access_token… -> on garde la clé, on masque la valeur. (Les schémas
// d'autorisation Bearer/Basic sont gérés à part pour conserver le nom du schéma
// ET masquer l'intégralité des creds, y compris après « Authorization: ».)
const RE_SECRET_KV =
  /\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|sid)\b(\s*[:=]\s*|"\s*:\s*"?)([^\s,;"'&)}]+)/gi;

// Schémas d'autorisation HTTP : « Bearer <token> » / « Basic <creds> ».
const RE_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const RE_BASIC = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi;
// JWT : ancré sur "eyJ" (base64url de `{"`), pour ne PAS avaler les identifiants
// pointés des stacks (ex. Object.Module.exports) qui auraient 3 segments.
const RE_JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
// Clés d'API à préfixe connu : sk-/pk-/rk_ (Stripe/OpenAI-like), mip_<hex> (nos clés)
const RE_PREFIXED_KEY = /\b(?:sk|pk|rk|ghp|gho|xox[abpr])[-_][A-Za-z0-9]{8,}\b/gi;
const RE_MIP_KEY = /\bmip_[A-Za-z0-9]{8,}\b/gi;
// Emails
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Adresses IPv4 (PII potentielle)
const RE_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Longues suites de chiffres (cartes, téléphones, n° de compte) — ≥ 9 pour
// épargner les petits identifiants/codes d'erreur. Les séparateurs - et espace
// sont tolérés à l'intérieur (ex. n° de carte formaté).
const RE_LONG_NUM = /\b\d(?:[ -]?\d){8,}\b/g;

/**
 * Nettoie un texte libre (message d'erreur, stack, label…). Conservateur :
 * masque secrets et données personnelles, garde le reste lisible.
 * @param {unknown} input
 * @returns {string|null} texte nettoyé, null si entrée non-string.
 */
export function scrubText(input) {
  if (typeof input !== "string") return null;
  return input
    .replace(RE_SECRET_KV, (_m, key, sep) => `${key}${sep}[redacted]`)
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
 * Nettoie une URL : retire query string et fragment (PII, PLAN §14) PUIS masque
 * les secrets/emails restés dans le chemin (rares mais possibles). On ne touche
 * PAS aux longues suites de chiffres ni aux IP d'une URL (un id numérique de
 * chemin reste utile et non identifiant).
 * @param {unknown} url
 * @returns {string|null}
 */
export function scrubUrl(url) {
  if (typeof url !== "string") return null;
  const base = url.split("?")[0].split("#")[0];
  return base
    .replace(RE_SECRET_KV, (_m, key, sep) => `${key}${sep}[redacted]`)
    .replace(RE_JWT, "[jwt]")
    .replace(RE_PREFIXED_KEY, "[key]")
    .replace(RE_MIP_KEY, "[key]")
    .replace(RE_EMAIL, "[email]");
}

// Clés d'objet (props d'événements) dont la valeur est masquée intégralement.
const SECRET_KEY = /pass(?:word|wd)?|pwd|secret|token|api[_-]?key|auth|bearer|email|e[_-]?mail|phone|ssn|credit|card|cvv|iban/i;

/**
 * Nettoie récursivement un objet de props (mip.props, défini par le client donc
 * à risque). Masque la valeur des clés au nom sensible, nettoie les strings, et
 * borne la profondeur pour ne pas exploser sur un objet hostile.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function scrubProps(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubProps(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrubProps(v, depth + 1);
    }
    return out;
  }
  return value; // number/boolean : non identifiant, conservé tel quel
}
