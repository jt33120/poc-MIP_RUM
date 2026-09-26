// La méthode d'un chiffre ou d'une figure, rangée DERRIÈRE un repli « Méthode ».
// Rendu serveur (un `<details>` natif : ni état, ni JavaScript).
//
// POURQUOI (recette du 26/09/2026). Presque chaque carte des écrans de performance
// portait trois à sept lignes de méthodologie (Pettitt, Spearman, moindres carrés,
// bornes, pondérations) AVANT l'information : le chiffre se perdait. Ce qui aide à
// lire reste visible ; ce qui dit comment on a calculé passe ici, un clic plus loin.
// Rien n'est retiré : le texte reste dans le HTML, lisible par un lecteur d'écran.
import type { ReactNode } from "react";

export function Methode({
  children,
  titre = "Méthode",
  className = "",
  testId,
}: {
  children: ReactNode;
  /** Le libellé du repli (« Méthode », « Comment ce score est calculé »). */
  titre?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <details className={`text-xs text-ink-soft ${className}`} data-testid={testId}>
      <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">{titre}</summary>
      <div className="mt-1 leading-relaxed">{children}</div>
    </details>
  );
}
