// `next/headers`, réduit à ce que le graphe de l'API v1 importe.
//
// Seule `POST /api/v1/deploys` l'appelle (pour refuser une session), et le service
// `api` ne monte pas cette route : elle écrit. Le shim existe pour que le bundle
// se construise ; s'il est un jour appelé, il ne rend aucun cookie — comme le
// reste de l'API publique.
export async function cookies() {
  return { get: () => undefined, getAll: () => [], has: () => false };
}

export async function headers() {
  return new Headers();
}
