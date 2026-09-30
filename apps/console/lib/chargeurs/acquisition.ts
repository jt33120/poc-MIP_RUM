// LE CHARGEUR DE L'ÉCRAN « Acquisition » (C5) — `app/acquisition/page.tsx`.
//
// Canaux, pages d'entrée et référents (plafonnés, et le plafond est dit), leur
// série, l'échantillonnage — même population que la lecture : les sessions ayant
// une vue sur la fenêtre (S7) ; sous `cmp=prev`, la période précédente et la
// couverture des vues. Chaque lecture est indépendante (F02).
import { PLAFOND_ACQUISITION } from "../acquisition";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { acquisition, acquisitionSerie } from "../queries-acquisition";
import { samplingSessions } from "../queries-sessions";
import { paramReader } from "../query-contract";
import { lireComparaison } from "../view-state";
import { sectionFenetresCollecte } from "./collecte";
import { section, type Chargeur } from "./commun";

const SOURCE_VUES: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

export const chargerAcquisition = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/acquisition");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const query = ecran.query;
  // Comparaison (F06, F53) : `cmp=prev` compare les tuiles à la période précédente.
  const prev = lireComparaison("/acquisition", paramReader(sp)).valeur.mode === "prev";
  const [lecture, lecturePrev, serie, echantillonnage, couvertures, fenetresCollecte] = await Promise.all([
    section(() => acquisition(f)),
    prev ? section(() => acquisition(f, PLAFOND_ACQUISITION, true)) : Promise.resolve(null),
    section(() => acquisitionSerie(f)),
    section(() => samplingSessions(f, { population: { lecture: "vues" } })),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_VUES).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
    // Les hachures « non mesuré » de la série par canal : une section à part.
    sectionFenetresCollecte(query),
  ]);
  return { etat: "ok", query, label: ecran.label, bucketLabel: ecran.bucketLabel, prev, lecture, lecturePrev, serie, echantillonnage, couvertures, fenetresCollecte } as const;
}) satisfies Chargeur<unknown>;
