// Pagination des endpoints de liste de l'API v1. Helper PUR (URLSearchParams -> {limit, offset}),
// sans import next/*. `limit` borné [1, max], `offset` >= 0 ; défauts alignés sur les caps
// historiques des requêtes (50 sessions, 100 groupes d'erreurs) pour préserver le comportement.
export interface Pagination {
  limit: number;
  offset: number;
}

export function parsePagination(sp: URLSearchParams, def: number, max = 200): Pagination {
  const l = Number(sp.get("limit"));
  const o = Number(sp.get("offset"));
  const limit = Number.isFinite(l) && l > 0 ? Math.min(Math.floor(l), max) : def;
  const offset = Number.isFinite(o) && o > 0 ? Math.floor(o) : 0;
  return { limit, offset };
}
