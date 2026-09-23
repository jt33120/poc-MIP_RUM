// CORS partagé — source UNIQUE pour l'edge function (Deno, prod) et le
// dev-server (Node, local/CI), au même titre que otlp.mjs. Élimine par
// construction la divergence des règles d'origine entre les deux chemins
// (revue R6), et applique la règle stricte (revue R7) : une origine NON
// autorisée ne reçoit AUCUN en-tête Access-Control-Allow-Origin — plutôt que
// de refléter une origine tierce du socle, comportement surprenant et inutile.

// Socle statique (toujours accepté). Les origines des clients enregistrés via
// la console (app_registry.allowed_origins) s'y ajoutent dynamiquement, passées
// par l'appelant en `extraOrigins`.
export const STATIC_ALLOWED_ORIGINS = [
  "https://plateforme.groupement-it.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
];

/** L'origine est-elle autorisée ? (socle statique ∪ origines d'apps actives). */
export function isAllowedOrigin(origin, extraOrigins = []) {
  if (!origin) return false;
  return STATIC_ALLOWED_ORIGINS.includes(origin) || extraOrigins.includes(origin);
}

/**
 * En-têtes CORS pour une requête. `Access-Control-Allow-Origin` n'est présent
 * QUE si l'origine est autorisée ; sinon seuls les en-têtes de préflight sont
 * renvoyés (le navigateur bloque, ce qui est le comportement voulu).
 * @param {string} origin  en-tête Origin de la requête ("" si absent)
 * @param {string[]} [extraOrigins]  origines dynamiques (apps actives du registre)
 * @param {{allowHeaders?: string}} [opts]  en-têtes autorisés (défaut "content-type" ;
 *        l'ingestion replay y ajoute x-mip-session/x-mip-app/x-mip-seq)
 */
export function corsHeaders(origin, extraOrigins = [], opts = {}) {
  const preflight = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": opts.allowHeaders ?? "content-type",
    "Access-Control-Max-Age": "86400",
  };
  return isAllowedOrigin(origin, extraOrigins)
    ? { "Access-Control-Allow-Origin": origin, ...preflight }
    : { ...preflight };
}

/** En-têtes autorisés pour l'ingestion replay (corps binaire + métadonnées x-mip-*).
 *  x-mip-key : clé d'API optionnelle (apps qui en exigent une) — DOIT figurer ici,
 *  sinon le préflight CORS bloque le POST replay cross-origin des clients à clé. */
export const REPLAY_ALLOW_HEADERS = "content-type,x-mip-session,x-mip-app,x-mip-seq,x-mip-key";

/** Aplati les origines des apps actives d'un registre (Map ou itérable de valeurs). */
export function originsFromRegistry(registryValues) {
  const out = [];
  for (const app of registryValues) {
    if (app?.active && Array.isArray(app.allowed_origins)) out.push(...app.allowed_origins);
  }
  return out;
}
