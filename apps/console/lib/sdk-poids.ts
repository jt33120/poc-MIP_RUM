// Le poids des bundles publiés. UN SEUL ENDROIT, pour six écrans.
//
// POURQUOI UN MODULE À PART, et pas une constante de lib/specs.ts : ces valeurs
// sont citées par des composants CLIENT (le carrousel d'intégration) autant que
// par la vitrine serveur. Les prendre dans specs.ts y tirerait dashboard-blocs,
// legal et mcp-public — tout le graphe des specs — dans le bundle du navigateur,
// pour trois nombres. Ce fichier n'importe RIEN : c'est ce qui le rend citable
// de partout.
//
// POURQUOI PAS UNE CHAÎNE ÉCRITE À LA MAIN. « ~12 ko » a survécu à un passage de
// 12,4 à 12,6 ko sans que rien ne bronche, à six endroits à la fois. Les valeurs
// sont REMESURÉES sur les fichiers versionnés par tests/unit/specs.test.ts : un
// rebuild qui change le poids fait rougir la CI et donne le nouveau nombre à
// écrire ici — une fois.

/** Bundle cœur publié (apps/console/public/mip-rum.js), gzip. Mesuré. */
export const SDK_GZIP_KO = 22.0;
/** Budget que packages/rum-sdk/build.mjs refuse de dépasser. */
export const SDK_BUDGET_KO = 35;
/** Bundle rejeu (rrweb), chargé À LA DEMANDE et seulement si le rejeu est activé. */
export const REPLAY_GZIP_KO = 56.7;
/** Widget d'avis, chargé à la demande lui aussi. */
export const FEEDBACK_GZIP_KO = 7.6;

/** Un nombre écrit à la française : 12.6 -> « 12,6 ». */
export function koTexte(ko: number): string {
  return ko.toString().replace(".", ",");
}

/** Le poids du cœur tel qu'il s'écrit dans une phrase : « 12,6 ko gzip ». */
export const SDK_POIDS_TEXTE = `${koTexte(SDK_GZIP_KO)} ko gzip`;
