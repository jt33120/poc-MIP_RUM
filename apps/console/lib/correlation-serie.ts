// Paramètre d'écran `serie` de /correlation : le couple (app, route) affiché par le
// hero « Robot face au réel » (§ 5.7, CR7-a). Module pur, sans accès base.
//
// POURQUOI UN COUPLE ET PAS UNE ROUTE. Sous `app=all`, deux apps peuvent avoir une
// route `/checkout` : une série choisie par la route seule mélangeait leurs heures
// (deux points par heure, jointure par route). Une heure et une route ne désignent
// une mesure qu'avec leur app.
//
// FORMAT. `encodeURIComponent(app) + ":" + encodeURIComponent(route)`.
// `encodeURIComponent` encode `:` en `%3A` : le PREMIER `:` de la valeur sépare donc
// toujours l'app de la route, même pour une route paramétrée comme `/partners/:id`.
// La valeur est ensuite passée telle quelle à l'URL (`hrefWithQuery`), qui l'encode
// une seconde fois ; `searchParams` rend la valeur ci-dessus.

export interface CoupleSerie {
  app_id: string;
  route: string;
}

/** Valeur du paramètre `serie` pour un couple. */
export function ecrireSerie(app: string, route: string): string {
  return `${encodeURIComponent(app)}:${encodeURIComponent(route)}`;
}

function decoder(partie: string): string | null {
  try {
    return decodeURIComponent(partie);
  } catch {
    // `%E0%A4%A` : séquence invalide. Une valeur illisible est ignorée, jamais levée.
    return null;
  }
}

/**
 * Couple désigné par `serie`, s'il figure parmi les options ; sinon `null` (la
 * valeur est ignorée, l'écran applique son défaut).
 *
 * Compatibilité : une valeur égale à la route d'une option vient d'un lien
 * antérieur (`serie=/checkout`, `serie=/partners/:id`) et désigne une route. Elle
 * n'est retenue que si UNE seule option porte cette route : avec deux apps,
 * choisir l'une des deux serait deviner.
 *
 * Cette lecture passe AVANT la coupe au `:` : une route paramétrée brute
 * (`/partners/:id`) contient un `:` qui n'est pas le séparateur — le format couple
 * l'encode en `%3A`. Coupée d'abord, elle devenait l'app `/partners/` et la route
 * `id`, introuvables. Aucune valeur au format couple n'égale une route : l'app
 * encodée ne commence jamais par `/` (encodé `%2F`).
 */
export function lireSerie(
  valeur: string | null | undefined,
  options: readonly CoupleSerie[],
): CoupleSerie | null {
  if (!valeur) return null;
  const memeRoute = options.filter((o) => o.route === valeur);
  if (memeRoute.length > 0) return memeRoute.length === 1 ? memeRoute[0] : null;
  const separateur = valeur.indexOf(":");
  if (separateur < 0) return null;
  const app = decoder(valeur.slice(0, separateur));
  const route = decoder(valeur.slice(separateur + 1));
  if (app === null || route === null) return null;
  return options.find((o) => o.app_id === app && o.route === route) ?? null;
}

/**
 * Couple affiché sans `serie` lisible (CR7-a) : la première option de la route du
 * contrat (`route=`), par ordre d'app ; sinon le couple qui a le plus d'heures en
 * angle mort ; sinon la première option par ordre (route, app).
 */
export function serieParDefaut(
  options: readonly CoupleSerie[],
  contexte: { route?: string | null; anglesMorts?: readonly (CoupleSerie & { heures: number })[] } = {},
): CoupleSerie | null {
  const triees = [...options].sort((a, b) =>
    a.route === b.route ? (a.app_id < b.app_id ? -1 : a.app_id > b.app_id ? 1 : 0) : a.route < b.route ? -1 : 1,
  );
  if (contexte.route) {
    const deLaRoute = triees.find((o) => o.route === contexte.route);
    if (deLaRoute) return deLaRoute;
  }
  // Les angles morts arrivent triés par heures décroissantes ; le premier qui est
  // aussi une option du sélecteur l'emporte.
  for (const a of contexte.anglesMorts ?? []) {
    if (a.heures <= 0) break;
    const option = triees.find((o) => o.app_id === a.app_id && o.route === a.route);
    if (option) return option;
  }
  return triees[0] ?? null;
}

/**
 * Libellé d'une option : la route seule quand toutes les options sont d'une même
 * app ; sinon « app · route », puisque la route seule ne dit plus de quelle app il
 * s'agit.
 */
export function libelleSerie(couple: CoupleSerie, options: readonly CoupleSerie[]): string {
  const apps = new Set(options.map((o) => o.app_id));
  return apps.size > 1 ? `${couple.app_id} · ${couple.route}` : couple.route;
}
