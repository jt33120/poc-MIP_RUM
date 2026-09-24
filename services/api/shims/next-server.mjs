// `next/server`, réduit à ce que les routes de l'API v1 utilisent, hors de Next.
//
// POURQUOI UN SHIM ET PAS NEXT. Les routes de `apps/console/app/api/v1` sont des
// route handlers Next : elles reçoivent un `NextRequest` et rendent un
// `NextResponse`. Ce sont deux sous-classes minces des objets Web standard
// (`Request`, `Response`) ; embarquer Next entier dans un service Railway pour
// ces deux classes et `after()` coûterait une image lourde et un runtime qui
// n'est pas fait pour tourner hors de son serveur. Le service `api` exécute donc
// LE MÊME CODE que la console, avec ces trois pièces-ci à la place de Next.
//
// CE QUE CE SHIM NE FAIT PAS, À DESSEIN : lire un cookie. `cookies.get()` ne rend
// jamais rien — l'API publique n'authentifie que par jeton (`cookie = null`).
// C'est la garantie que l'on vérifie aussi au build : `lib/auth.ts`, qui vérifie
// les sessions de la console, n'entre pas dans le bundle.

/** Aucun cookie, jamais : l'API publique est machine à machine. */
const SANS_COOKIE = Object.freeze({
  get: () => undefined,
  getAll: () => [],
  has: () => false,
});

export class NextRequest extends Request {
  /**
   * @param {RequestInfo | URL} entree
   * @param {RequestInit} [init]
   */
  constructor(entree, init) {
    super(entree, init);
    /** L'URL analysée, comme `req.nextUrl` de Next (pathname, searchParams). */
    this.nextUrl = new URL(typeof entree === "string" || entree instanceof URL ? entree : entree.url);
    this.cookies = SANS_COOKIE;
  }
}

export class NextResponse extends Response {
  /**
   * @param {unknown} corps
   * @param {ResponseInit} [init]
   */
  static json(corps, init = {}) {
    const entetes = new Headers(init.headers);
    if (!entetes.has("content-type")) entetes.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(corps), { ...init, headers: entetes });
  }

  /**
   * @param {string | URL} url
   * @param {number | ResponseInit} [init]
   */
  static redirect(url, init = 307) {
    const statut = typeof init === "number" ? init : (init.status ?? 307);
    const entetes = new Headers(typeof init === "number" ? undefined : init.headers);
    entetes.set("location", String(url));
    return new NextResponse(null, { status: statut, headers: entetes });
  }
}

/**
 * `after()` de Next : exécuter APRÈS la réponse, sans la retarder ni la faire
 * échouer. Ici : au tour suivant de la boucle d'événements, erreurs avalées.
 * @param {(() => unknown) | Promise<unknown>} travail
 */
export function after(travail) {
  setImmediate(() => {
    // Dans `then` : une exception SYNCHRONE du travail devient un rejet, avalé
    // comme les autres — jamais une erreur non rattrapée qui tuerait le processus.
    Promise.resolve()
      .then(() => (typeof travail === "function" ? travail() : travail))
      .catch(() => {});
  });
}
