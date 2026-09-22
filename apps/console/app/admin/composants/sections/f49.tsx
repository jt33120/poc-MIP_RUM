// Vitrine — F49 : la matrice cohorte × semaine de `/retention` (plan § 4.3,
// § 5.17). Données FIXES écrites ici, passées par les mêmes fonctions pures que
// l'écran (`cellulesDeCohorte`) : aucune lecture en base.
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import { MatriceCohortes } from "@/components/charts/MatriceCohortes";
import { cellulesDeCohorte, type CohortRow } from "@/lib/cohorts";

/** Semaine « en cours » fictive, et quatre cohortes : 120, 64, 7 (effectif faible) et 30 visiteurs. */
const COURANTE = 3000;
const cohorte = (cohort: number, size: number, retenus: number[]): CohortRow => ({
  cohort,
  size,
  cells: retenus.map((retained, offset) => ({ offset, retained, rate: retained / size })),
});
const ROWS = [
  cohorte(2997, 120, [120, 52, 31, 12]),
  cohorte(2998, 64, [64, 22, 9]),
  cohorte(2999, 7, [7, 3]),
  cohorte(3000, 30, [30]),
];
const ETIQUETTES = ["sem. du 31/08", "sem. du 07/09", "sem. du 14/09", "sem. du 21/09"];

export function SectionF49() {
  return (
    <section id="matrice-cohortes" className="mb-10 min-w-0" aria-labelledby="matrice-cohortes-titre">
      <h2 id="matrice-cohortes-titre" className="text-base font-semibold text-ink">
        MatriceCohortes
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">
        « n / taille » et le taux dans chaque case ; échelle SEQUENTIELLE sans verdict ; semaine en cours hachurée ;
        effectif faible sous 10 visiteurs ; l&apos;avenir reste vide.
      </p>
      <div className="card p-4">
        <MatriceCohortes
          colonnes={4}
          lignes={ROWS.map((r, i) => ({ cohorte: ETIQUETTES[i], taille: r.size, cellules: cellulesDeCohorte(r, COURANTE, 4) }))}
        />
      </div>
    </section>
  );
}
