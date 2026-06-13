// Garde-fous de charge — runtime-agnostic (Node + Deno).
//
// Pourquoi : `await req.json()` / la concaténation du corps lisent par défaut
// un body de taille arbitraire. Un client (ou un attaquant) qui poste 200 Mo
// fait exploser la mémoire de l'isolat avant même le parsing. On rejette tôt
// (HTTP 413) sur le Content-Length, et on borne le nombre de spans réellement
// traités pour qu'un corps « valide mais énorme » ne monopolise pas le CPU.

/** Taille max du corps OTLP accepté (octets). Surchargable par env. */
export const MAX_BODY_BYTES = numEnv("MAX_BODY_BYTES", 2_000_000); // 2 Mo

/** Nombre max de spans traités par requête (au-delà : comptés `rejected`). */
export const MAX_SPANS_PER_REQUEST = numEnv("MAX_SPANS_PER_REQUEST", 20_000);

function numEnv(name, fallback) {
  const raw = readEnv(name);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readEnv(name) {
  try {
    if (typeof Deno !== "undefined" && Deno?.env) return Deno.env.get(name) ?? undefined;
  } catch {
    /* env inaccessible */
  }
  if (typeof process !== "undefined" && process?.env) return process.env[name];
  return undefined;
}

/**
 * Le Content-Length annoncé dépasse-t-il la limite ? (null/absent : on laisse
 * passer — le garde mémoire en aval prend le relais selon le runtime).
 * @param {string|number|null|undefined} contentLength
 */
export function bodyTooLarge(contentLength, max = MAX_BODY_BYTES) {
  if (contentLength == null) return false;
  const n = Number(contentLength);
  return Number.isFinite(n) && n > max;
}
