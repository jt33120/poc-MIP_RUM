// LES DÉTECTIONS DE LA VUE D'ENSEMBLE (refonte du monitoring, vague 3b), lues par
// `chargerOverview` (`chargeurs/overview.ts`), donc servies aussi par console-api.
//
// Trois lectures, chacune une section (F02) :
//   · la plage habituelle horaire des trois vitals du hero (`vital_horaire`), lue
//     SEULEMENT si elle peut être tracée (`raisonSansPlage` : grille d'une heure,
//     population entière, hors comparaison de releases) — un cas sans objet ne
//     coûte aucune requête ;
//   · les constats de la période (`signal_detecte`) ;
//   · les seaux horaires du LCP (`metric_histogram_hourly`) pour la heatmap de
//     latence (A2 § 6.2), sous les mêmes conditions que la plage.
//
// Un module à part, et pas des lignes de plus dans le `Promise.all` de
// `chargerOverview` : la règle « lue seulement si traçable » et le gabarit de
// vocabulaire des détections (`tests/unit/detections-horaires.test.ts`) portent sur
// ce fichier. `mip_console` lit `vital_horaire` et `signal_detecte` depuis
// migration-v104 ; avant, ces lectures tournaient dans la console seule (#364).
import { raisonSansPlage } from "../detections-ecran";
import { constatsDeLaPeriode, serieVitalHoraire } from "../queries-detections";
import { histogrammesHoraires } from "../queries-heatmap";
import { type AnalyticsQuery } from "../query-contract";
import { CONSTATS_MAX } from "./constats";
import { section } from "./commun";

/** Les vitals du hero, dans son ordre (même liste que `VITAUX_HERO` de `chargeurs/overview.ts`). */
export const VITAUX_PLAGE = ["LCP", "INP", "CLS"] as const;
/** Le vital de la heatmap de latence. */
export const VITAL_HEATMAP = "LCP";

/**
 * Les détections de `/` pour la requête de l'écran. Hero éteint (`heroAllume`
 * faux) ou comparaison de releases (`modeRelease`) : la plage n'est pas tracée, et
 * ni elle ni la heatmap ne sont lues.
 */
export async function lireDetectionsAccueil(query: AnalyticsQuery, heroAllume: boolean, modeRelease: boolean) {
  const sansPlage = heroAllume ? raisonSansPlage({ seauSecondes: query.range.bucketSeconds, filtres: query.filters, modeRelease }) : "bloc éteint";
  const [plages, constats, heatmap] = await Promise.all([
    sansPlage === null ? Promise.all(VITAUX_PLAGE.map((nom) => section(() => serieVitalHoraire(query, nom, "")))) : Promise.resolve(null),
    section(() => constatsDeLaPeriode(query, CONSTATS_MAX)),
    sansPlage === null ? section(() => histogrammesHoraires(query, VITAL_HEATMAP)) : Promise.resolve(null),
  ]);
  return { sansPlage, plages, constats, heatmap } as const;
}
