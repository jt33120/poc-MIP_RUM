"use client";
// OngletsRepresentation — la rangée « Valeur · Classement · Série · Lignes ·
// Distribution » de l'Explorer, qui SIGNALE ce qu'elle cache.
//
// POURQUOI (recette du 26/09/2026). À 390 px, la rangée défilait sans le dire :
// « Distribution » était coupé en « Di… », et rien n'indiquait qu'il restait des
// onglets à droite. Même geste que la barre d'onglets et la barre de vues
// (`SubNav`, `PresetBar`) : un dégradé ET un chevron du côté où il en reste, mesurés
// par `useDebordementHorizontal`. Les onglets eux-mêmes restent rendus côté serveur
// (ils arrivent en `children`) : ce composant ne fait que regarder la rangée.
import { useRef, type ReactNode } from "react";
import { ICON_PATHS, Icon } from "@/components/icons";
import { useDebordementHorizontal } from "@/components/TableDefilante";

export function OngletsRepresentation({ children, cle }: { children: ReactNode; cle?: string }) {
  const rangee = useRef<HTMLDivElement>(null);
  // `cle` : la représentation courante — la rangée se remesure quand elle change.
  const { gauche, droite } = useDebordementHorizontal(rangee, cle);
  return (
    // `relative` : les raisons `sr-only` des onglets désactivés sont en `position:
    // absolute` ; sans ancêtre positionné, elles se plaçaient par rapport à la PAGE
    // et l'élargissaient à 390 px (piège 16 du brief).
    <nav aria-label="Représentation" data-testid="explorer-representation" className="relative mb-6">
      {/* La bordure reste sur la zone qui défile : le soulignement de l'onglet actif
          (`-mb-px`) la recouvre, comme avant l'ajout des chevrons. */}
      <div ref={rangee} className="relative flex overflow-x-auto border-b border-line">
        {children}
      </div>
      {gauche && (
        <span
          aria-hidden="true"
          data-testid="representation-deborde-gauche"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-start bg-gradient-to-r from-app via-app/90 to-transparent text-ink-soft"
        >
          <Icon paths={ICON_PATHS.chevronLeft} className="h-4 w-4" />
        </span>
      )}
      {droite && (
        <span
          aria-hidden="true"
          data-testid="representation-deborde"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l from-app via-app/90 to-transparent text-ink-soft"
        >
          <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
