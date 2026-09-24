// La table des routes de l'API publique, tirée de l'arborescence de la console.
//
// Next route par FICHIERS : `app/api/v1/errors/[fingerprint]/route.ts` sert
// `/api/v1/errors/<fingerprint>`. Le service `api` reprend exactement cette
// règle, calculée au build depuis les mêmes fichiers : une route ajoutée à la
// console existe ici au déploiement suivant, sans liste à tenir à la main — et
// les chemins sont IDENTIQUES (`/api/v1/…`), pour que le relais de la console
// transmette la requête telle quelle.
//
// LECTURE SEULE, PAR CONSTRUCTION. Le service ne sert que `GET`, `HEAD`,
// `OPTIONS`, et `POST` sur les seules routes qui lisent (l'Explorer : sa requête
// porte un AST, qui ne tient pas dans une query string). Toute écriture — triage,
// commentaires, liens, tickets, vues enregistrées, marqueurs de déploiement —
// répond 405 et reste à la console tant que `console-api` n'existe pas : ces
// routes s'authentifient par cookie de session, que l'API publique n'accepte pas.
// Plus tard, le rôle de base `mip_api` (migration v89) le garantira aussi côté base.

/** Les POST qui LISENT. Une entrée de plus ici est une décision relue. */
export const POST_DE_LECTURE = Object.freeze(["/api/v1/explorer/query"]);
const METHODES_LECTURE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Le chemin servi par un fichier de route, relatif à `app/`.
 * `api/v1/errors/[fingerprint]/route.ts` → `/api/v1/errors/[fingerprint]`.
 */
export function cheminDuFichier(relatifApp) {
  const sansRoute = relatifApp.replace(/\\/g, "/").replace(/(^|\/)route\.ts$/, "");
  return `/${sansRoute}`.replace(/\/+$/, "") || "/";
}

/** Motif d'un chemin : segments fixes, et `[nom]` pour un paramètre. */
export function motif(chemin) {
  const segments = chemin.split("/").filter(Boolean);
  const cles = [];
  const parties = segments.map((s) => {
    const m = /^\[([A-Za-z0-9_]+)\]$/.exec(s);
    if (m) {
      cles.push(m[1]);
      return "([^/]+)";
    }
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return { regex: new RegExp(`^/${parties.join("/")}/?$`), cles, dynamiques: cles.length, longueur: segments.length };
}

/**
 * Un routeur sur une table `[{ chemin, module }]`. Un segment fixe l'emporte sur
 * un paramètre (`/errors/facettes` avant `/errors/[fingerprint]`), comme Next.
 * @returns {(pathname: string) => ({ entree: object, params: Record<string, string> } | null)}
 */
export function creerRouteur(table) {
  const triee = table
    .map((e) => ({ ...e, ...motif(e.chemin) }))
    .sort((a, b) => a.dynamiques - b.dynamiques || b.longueur - a.longueur);
  return (pathname) => {
    for (const entree of triee) {
      const m = entree.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      entree.cles.forEach((cle, i) => {
        try {
          params[cle] = decodeURIComponent(m[i + 1]);
        } catch {
          params[cle] = m[i + 1];
        }
      });
      return { entree, params };
    }
    return null;
  };
}

/** Le service sert-il cette méthode sur ce chemin ? */
export function methodeServie(chemin, methode) {
  return METHODES_LECTURE.has(methode) || (methode === "POST" && POST_DE_LECTURE.includes(chemin));
}
