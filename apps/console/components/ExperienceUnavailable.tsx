// Aucun avis noté : ne jamais habiller l'absence d'une courbe ou d'une note numérique.
//
// Rendu dans le cadre des états (`CadreEtat`, § 3.8), à la hauteur du graphe qu'il
// remplace : même texte qu'avant F02.
import { CadreEtat } from "@/components/states/EtatSurface";

export function ExperienceUnavailable() {
  return (
    <div data-testid="xp-unavailable" className="flex h-[260px] items-center justify-center">
      <CadreEtat ton="neutre" role="status" etat="vide" className="max-w-sm text-center">
        <p className="text-lg font-semibold text-ink">Données insuffisantes</p>
        <p className="mt-1 text-xs text-ink-soft">Aucun avis noté sur cette période : la satisfaction ne se trace pas.</p>
      </CadreEtat>
    </div>
  );
}
