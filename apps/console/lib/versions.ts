// Versions des paquets telles que les textes de la vitrine les citent.
//
// Module FEUILLE (aucun import) : des composants de la vitrine les affichent, et
// les définir dans lib/specs tirerait tout le graphe des specs dans le bundle.
// `tests/unit/specs.test.ts` compare chaque valeur au package.json du paquet :
// la vitrine a annoncé « v0.1 » pour React Native alors que le paquet était en 0.4.0.

/** Version du SDK React Native, telle qu'elle est dans packages/rum-mobile/package.json. */
export const RN_VERSION = "0.4.0";
