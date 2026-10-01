// L'assistant de la Vue d'ensemble, en UN import pour l'écran (`app/page.tsx`) : le
// composant (client) et la construction de son condensé (serveur, sans requête).
// L'écran est refait par d'autres lots : son branchement tient en un import, un bloc
// avant le rendu et un élément, pour qu'une réécriture de la page le garde sans peine.
export { Assistant } from "./Assistant";
export { construireDigestVueEnsemble } from "@/lib/assistant/digest";
