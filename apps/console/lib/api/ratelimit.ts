// Rate limiting de l'API v1 : fenêtre glissante EN MÉMOIRE, par clé (sujet du principal).
// Best-effort par instance (serverless = plusieurs isolats) : première barrière anti-abus,
// pas une garantie distribuée — pour du strict, brancher un store partagé (Redis/PG).
// Cœur PUR & testable : l'horloge (`now`) et le `store` sont injectables.

const defaultStore = new Map<string, number[]>();

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetMs: number; // ms avant qu'un créneau se libère
}

/**
 * Enregistre un hit pour `key` et indique s'il passe sous `limit` sur `windowMs`.
 * Ne pousse le timestamp que si la requête est acceptée (une requête rejetée ne
 * repousse pas la fenêtre). Purge les hits hors fenêtre à chaque appel.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  store: Map<string, number[]> = defaultStore,
): RateResult {
  const hits = (store.get(key) ?? []).filter((t) => t > now - windowMs);
  const ok = hits.length < limit;
  if (ok) hits.push(now);
  store.set(key, hits);
  const resetMs = hits.length ? Math.max(0, hits[0] + windowMs - now) : 0;
  return { ok, limit, remaining: Math.max(0, limit - hits.length), resetMs };
}

/** Réinitialise le store par défaut (tests). */
export function _resetRateLimit(): void {
  defaultStore.clear();
}
