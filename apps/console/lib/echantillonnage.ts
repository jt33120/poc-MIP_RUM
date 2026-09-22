// Échantillonnage de la population d'un écran d'usage (F40, règle S7, lecture B38)
// — logique PURE, testée (tests/unit/echantillonnage.test.ts).
//
// POURQUOI. Nos comptes de sessions sont OBSERVÉS : le SDK peut n'en retenir
// qu'une partie (`sampleRate`), et aucun poids n'est appliqué (V4). Un écran qui
// affiche « 312 sessions » sans dire qu'il lit un échantillon laisse lire un total.
// Deux faits du SDK commandent les textes :
//   - l'échantillonnage est BIAISÉ-ERREURS : une session tirée « biaisée-erreurs »
//     n'émet que ses erreurs (packages/rum-sdk/src/sampling.ts), donc une part de
//     sessions en erreur calculée sur l'échantillon est surestimée ;
//   - avant le 09/09/2026 (migration v58), `sample_rate` vaut 1 PAR DÉFAUT, pas
//     par mesure : la probabilité d'inclusion de ces sessions est INCONNUE, et un
//     minimum qui les compte à 1 serait un « 100 % » inventé.
import type { Etat } from "@/components/states/EtatSurface";
import type { Lecture } from "./lecture";

/**
 * `rum_session.sample_rate` vaut 1 PAR DÉFAUT sur les lignes antérieures à v58
 * (migration-v58.sql:L26, L65) : un `is not null` ne les écarte pas. Sa collecte
 * réelle commence au 09/09/2026, date de la migration.
 */
export const DEBUT_SAMPLE_RATE = "2026-09-09T00:00:00.000Z";

/** Probabilité d'inclusion de la population lue par un écran (B38). */
export interface EchantillonnageSessions {
  /**
   * Plus petite probabilité d'inclusion des sessions lues :
   * `sample_rate + (1 − sample_rate) × error_sample_rate` pour une session en
   * erreur, `sample_rate` sinon (migration-v58.sql). `null` : aucune session lue.
   */
  probaMin: number | null;
  /** Sessions de la population. */
  sessions: number;
  /** Sessions commencées avant le 09/09/2026 : taux d'échantillonnage non enregistré. */
  sansTaux: number;
  /** Au moins une session tirée avec `sample_rate < 1` et `error_sample_rate > 0`. */
  biaiseErreurs: boolean;
}

/** L'état « échantillonné » d'`EtatSurface`, seul que rend `etatEchantillonnage`. */
export type EtatEchantillonne = Extract<Etat, { kind: "echantillonne" }>;

/**
 * Bandeau d'échantillonnage d'une population, ou `null` quand il n'est pas dû.
 *
 *   - aucune session lue → `null` : l'état « vide » des figures suffit ;
 *   - toutes les sessions retenues à coup sûr (`probaMin ≥ 1`, aucune sans taux)
 *     → `null` : rien n'est échantillonné, un bandeau serait du bruit ;
 *   - des sessions sans taux enregistré → `probaMin: null` (« inconnue ») : leur
 *     probabilité d'inclusion n'est pas bornée, un « au moins p % » serait faux ;
 *   - sinon → « au moins <probaMin> % », avec la mise en garde biaisée-erreurs
 *     quand elle s'applique.
 */
export function etatEchantillonnage(e: EchantillonnageSessions): EtatEchantillonne | null {
  if (!(e.sessions > 0)) return null;
  const sansTaux = e.sansTaux > 0 ? e.sansTaux : 0;
  const probaConnue = e.probaMin != null && Number.isFinite(e.probaMin);
  const echantillonne = !probaConnue || (e.probaMin as number) < 1;
  if (!echantillonne && sansTaux === 0) return null;
  return {
    kind: "echantillonne",
    unite: "session",
    probaMin: sansTaux > 0 || !probaConnue ? null : e.probaMin,
    ...(e.biaiseErreurs ? { biaiseErreurs: true } : {}),
    ...(sansTaux > 0 ? { sansTaux } : {}),
  };
}

/** Raison du bandeau quand la lecture de l'échantillonnage a échoué : jamais le silence. */
export const RAISON_ECHANTILLONNAGE_NON_LU = "échantillonnage non lu : les comptes peuvent porter sur un échantillon";

/**
 * Le bandeau d'une LECTURE d'échantillonnage : son état si elle a réussi, un
 * `partiel` qui le dit si elle a échoué. Une lecture en échec qui ne rendrait
 * rien laisserait croire que la population est complète.
 */
export function etatLectureEchantillonnage(lecture: Lecture<EchantillonnageSessions>): Etat | null {
  if (!lecture.ok) return { kind: "partiel", raison: RAISON_ECHANTILLONNAGE_NON_LU };
  return etatEchantillonnage(lecture.data);
}
