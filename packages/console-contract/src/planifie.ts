// L'ÉTAT DES TRAVAUX PLANIFIÉS, tel que la vitrine le montre.
//
// Repris de la console (`lib/etat-planifie.ts`, `lib/etat-latence.ts`) pour que
// console-api et la console partagent LA MÊME définition : `console-api` lit, la
// console affiche. Tant que la console garde sa copie (jusqu'à C0b), un test
// compare les deux (`tests/unit/console-api-c0a.test.ts`).

/** Une lecture de l'état du planificateur : une date (ou aucune), ou l'aveu que la lecture a échoué. */
export type LecturePlanifie = { etat: "lu"; date: Date | null; cadenceMin?: number | null } | { etat: "illisible" };

/** Les cadences de tick que le scheduler accepte (diviseurs de l'heure, 5 à 30 min). */
export const CADENCES_ADMISES: readonly number[] = Object.freeze([5, 10, 15, 20, 30]);

/** La valeur publiée par le scheduler (`platform_flag.scheduler_tick_min`), lue telle quelle ; `null` si absente ou hors grille. */
export function cadencePubliee(brut: unknown): number | null {
  const n = typeof brut === "string" && /^\d{1,2}$/.test(brut) ? Number(brut) : Number.NaN;
  return CADENCES_ADMISES.includes(n) ? n : null;
}
