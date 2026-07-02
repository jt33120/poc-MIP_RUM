// ETag faible pour les réponses JSON de l'API v1 : hash FNV-1a 32-bit du corps sérialisé.
// Permet les 304 (If-None-Match) et le cache navigateur/CDN. Helper PUR (aucun import).
// Faible (`W/`) car le hash porte sur la sémantique JSON, pas l'octet-à-octet.
export function weakEtag(body: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `W/"${(h >>> 0).toString(16)}"`;
}
