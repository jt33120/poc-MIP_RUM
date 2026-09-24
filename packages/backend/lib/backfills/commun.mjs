// P8.2 — le peu de vocabulaire que le planificateur, le runner et les quatre
// reconstructions partagent.
//
// Il vit à part pour une seule raison : `planner.mjs` importe les quatre
// modules de `kind`, et ceux-ci ont besoin du même format d'horodatage et des
// mêmes erreurs typées. Les faire remonter jusqu'au planificateur créerait un
// cycle d'import, et ESM le résoudrait en rendant des liaisons encore vides au
// moment où le module de `kind` s'évalue — un `undefined` silencieux au lieu
// d'une erreur.

/**
 * Horodatage UTC rendu à la MICROSECONDE, tel que PostgreSQL le conserve.
 *
 * Aucun curseur ni aucune borne ne passe par `Date` avant d'être sérialisé :
 * `Date` arrondit à la milliseconde, et deux lignes séparées de 400 µs
 * deviendraient le même curseur — l'une serait rejouée, l'autre sautée. Le
 * format est celui déjà utilisé par les curseurs de la console
 * (`analytics-compiler.ts`, `error-issue-workflow.ts`).
 */
export const ISO_US = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/**
 * Échec TYPÉ d'une reconstruction.
 *
 * `code` est un identifiant technique en minuscules, et c'est tout ce qui entre
 * dans `backfill_run.error_code` : un message PostgreSQL peut citer la valeur
 * d'une ligne, donc une donnée de personne. Une erreur reste une erreur — jamais
 * un succès de migration silencieux.
 */
export class ErreurBackfill extends Error {
  constructor(code, message, { reessayable = false } = {}) {
    super(message);
    this.name = "ErreurBackfill";
    this.code = code;
    this.reessayable = reessayable;
  }
}

/** Additionne des compteurs de skip par raison, sans en perdre aucune. */
export function fusionnerSkips(cible, ajout) {
  for (const [raison, n] of Object.entries(ajout ?? {})) {
    cible[raison] = (cible[raison] ?? 0) + n;
  }
  return cible;
}

/** Total d'un dictionnaire de compteurs. */
export function totalSkips(skips) {
  return Object.values(skips ?? {}).reduce((a, b) => a + b, 0);
}
