// Aucun avis noté : ne jamais habiller l'absence d'une courbe ou d'une note numérique.
//
// Rendu dans le cadre des états (`CadreEtat`, § 3.8) : même texte qu'avant F02, mais
// sur UNE ligne (recette du 30/09/2026) — il remplaçait le graphique par une boîte de
// 260 px au texte centré, un grand blanc au milieu du tableau de bord.
import { CadreEtat } from "@/components/states/EtatSurface";

export function ExperienceUnavailable() {
  return (
    <div data-testid="xp-unavailable">
      <CadreEtat ton="neutre" role="status" etat="vide" enLigne>
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span aria-hidden className="text-sm leading-none text-ink-faint">
            ⊘
          </span>
          <span className="font-medium text-ink">Données insuffisantes</span>
          <span>· aucun avis noté sur cette période : la satisfaction ne se trace pas.</span>
        </p>
      </CadreEtat>
    </div>
  );
}
