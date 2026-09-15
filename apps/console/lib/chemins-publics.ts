// Les chemins PUBLICS de la console : lisibles sans compte, et qui ne sont pas
// « la console ».
//
// UNE SEULE LISTE, POUR DEUX DÉCIDEURS. Le middleware s'en sert pour laisser
// passer un visiteur sans session ; le layout, pour ne PAS envelopper ces pages
// dans la coquille de la console (sidebar, en-tête, projet courant). Les deux
// répondaient à la question séparément, et ne donnaient pas la même réponse :
// le middleware laissait passer /presentation sans session, mais une fois
// connecté, la même URL était traitée comme un écran de console — porte
// « projet courant » comprise, donc `?app=` injecté dans l'URL et sidebar
// autour de la vitrine. Un utilisateur connecté ne pouvait plus voir la page
// d'accueil publique de son propre produit.
//
// Deux listes qui répondent à la même question finissent par diverger ; le
// dépôt l'a déjà payé trois fois (les receveurs d'ingestion, la liste des
// endpoints de l'API, les sous-traitants LLM). Celle-ci est la réponse.
//
// Fonction PURE, sans import : le middleware tourne sur le runtime edge, où
// `node:*` n'existe pas.

/**
 * Ce chemin est-il une page publique ?
 *
 *   /presentation       la vitrine — ce qu'on montre avant de connaître le produit
 *   /extension-privacy  politique de confidentialité de l'extension : URL PUBLIQUE
 *                       exigée par le Chrome Web Store, donc jamais derrière un login
 *   /legal/*            mentions, CGU, CGV, confidentialité, DPA — des documents
 *                       opposables, qui doivent être lisibles par quiconque, y
 *                       compris par un utilisateur connecté qui n'a pas encore
 *                       choisi de projet
 */
export function estCheminPublic(pathname: string): boolean {
  return (
    pathname === "/presentation" ||
    pathname === "/extension-privacy" ||
    pathname === "/legal" ||
    pathname.startsWith("/legal/")
  );
}

/**
 * Ce chemin se rend-il en PLEIN ÉCRAN, sans la coquille console, pour un
 * utilisateur connecté ? /select (le choix du projet, forcément avant d'en avoir
 * un) et les pages publiques. Partagé par le layout, qui décide, et par
 * CoquilleGarde, qui vérifie côté client que la décision suit la navigation.
 */
export function estCoquilleNue(pathname: string): boolean {
  return pathname === "/select" || pathname.startsWith("/select/") || estCheminPublic(pathname);
}
