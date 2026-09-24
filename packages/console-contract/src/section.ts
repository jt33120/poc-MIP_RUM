// UNE SECTION D'ÉCRAN, SUR LE FIL.
//
// L'unité de découpage des écrans est l'appel `lire()` de la console
// (`apps/console/lib/lecture.ts`) : une section qui échoue tombe SEULE, sans
// emporter l'écran. Un loader de console-api rend donc un résultat PAR SECTION,
// et n'échoue jamais en bloc pour une section.
//
// La RAISON d'un échec ne voyage pas : elle reste dans le journal du service,
// avec le `request_id` de l'enveloppe. Côté console, l'écran n'affiche que le
// titre de la section en échec — exactement ce que fait `lire()` aujourd'hui.
export type Section<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly code: "lecture_en_echec" };
