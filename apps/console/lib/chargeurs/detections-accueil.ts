// LE CHARGEUR DES DÉTECTIONS DE LA VUE D'ENSEMBLE (refonte du monitoring, vague 3b).
//
// Deux lectures, chacune une section (F02) :
//   · la plage habituelle horaire des trois vitals du hero (`vital_horaire`), lue
//     SEULEMENT si elle peut être tracée (`raisonSansPlage` : grille d'une heure,
//     population entière, hors comparaison de releases) — un cas sans objet ne
//     coûte aucune requête ;
//   · les constats de la période (`signal_detecte`) ;
//   · les seaux horaires du LCP (`metric_histogram_hourly`) pour la heatmap de
//     latence (A2 § 6.2), sous les mêmes conditions que la plage.
//
// POURQUOI UN CHARGEUR À PART, ET PAS DANS `chargerOverview`. `chargerOverview` part
// dans le bundle de console-api ; la garde C13 (`scripts/ci/verify-db-roles-console.mjs`)
// refuse un bundle qui NOMME une relation sans droit pour `mip_console` — et v101 n'a
// pas encore accordé ces deux tables à ce rôle (PR #362, « pour le lot suivant »).
// Ce chargeur tourne donc dans la console seule (`chargerComplementLocal`), jusqu'à la
// migration qui accordera les droits ; il rejoindra alors `chargerOverview`.
import { analyserFiltres } from "../filtres-ecran";
import { raisonSansPlage } from "../detections-ecran";
import { constatsDeLaPeriode, serieVitalHoraire } from "../queries-detections";
import { histogrammesHoraires } from "../queries-heatmap";
import { lireComparaison } from "../view-state";
import { paramReader } from "../query-contract";
import { CONSTATS_MAX } from "./constats";
import { blocsDe, section, type Chargeur } from "./commun";

/** Les vitals du hero, dans son ordre (même liste que `VITAUX_HERO` de `chargeurs/overview.ts`). */
export const VITAUX_PLAGE = ["LCP", "INP", "CLS"] as const;
/** Le vital de la heatmap de latence. */
export const VITAL_HEATMAP = "LCP";

export const chargerDetectionsAccueil = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/");
  if (!ecran.ok) return { etat: "refus" } as const;
  const query = ecran.query;
  const blocs = blocsDe(sp, "/");
  const modeRelease = lireComparaison("/", paramReader(sp)).valeur.mode === "release";
  const sansPlage = blocs.hero ? raisonSansPlage({ seauSecondes: query.range.bucketSeconds, filtres: query.filters, modeRelease }) : "bloc éteint";
  const [plages, constats, heatmap] = await Promise.all([
    sansPlage === null ? Promise.all(VITAUX_PLAGE.map((nom) => section(() => serieVitalHoraire(query, nom, "")))) : Promise.resolve(null),
    section(() => constatsDeLaPeriode(query, CONSTATS_MAX)),
    sansPlage === null ? section(() => histogrammesHoraires(query, VITAL_HEATMAP)) : Promise.resolve(null),
  ]);
  return { etat: "ok", sansPlage, plages, constats, heatmap } as const;
}) satisfies Chargeur<unknown>;
