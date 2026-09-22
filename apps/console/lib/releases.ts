// Libellés de release partagés par le serveur et le navigateur.
//
// Module FEUILLE (aucun import) : `lib/presets.ts` est chargé par un composant client
// (`PresetBar`) ; y importer une valeur de `lib/queries-deploys.ts` tirerait `pg` dans
// le bundle du navigateur. `queries-deploys` réexporte la constante.

/** Libellé du groupe des mesures qui ne déclarent aucune release. */
export const SANS_RELEASE = "(non renseignée)";
