// Primitives présentationnelles du wizard d'onboarding client (badge d'état +
// section numérotée). Extraites de app/admin/customers/[appId]/page.tsx.
//
// Jetons du thème, jamais de couleur écrite en dur : la fiche client restait blanche
// en mode sombre (recette du 26/09/2026). L'état se lit par une icône et un mot, pas
// par un émoji.
import type { ReactNode } from "react";
import { ICON_PATHS, Icon } from "@/components/icons";
import type { StepState } from "@/lib/onboarding";

/** Coche de l'état « fait » (le jeu d'icônes partagé n'en a pas). */
const COCHE = <path d="M20 6 9 17l-5-5" />;

/** Badge d'état d'une case de la checklist d'onboarding (fait / en attente). */
export function WizardBadge({ state, children }: { state: StepState; children: ReactNode }) {
  const fait = state === "done";
  return (
    <span
      data-etat={state}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        fait ? "bg-good/15 text-good-ink" : "bg-warn/10 text-warn-ink"
      }`}
    >
      <Icon paths={fait ? COCHE : ICON_PATHS.timer} className="h-3.5 w-3.5" strokeWidth={2.4} />
      <span className="sr-only">{fait ? "Fait : " : "En attente : "}</span>
      {children}
    </span>
  );
}

/** Section numérotée du wizard (étape N + titre + contenu). */
export function WizardStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    // `min-w-0` : l'étape est un élément de grille ; sans lui, elle prenait la largeur
    // de son plus long bloc de code et portait la fiche client à 719 px sur 390.
    <section className="card min-w-0 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-perf/10 text-xs font-bold text-perf">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
