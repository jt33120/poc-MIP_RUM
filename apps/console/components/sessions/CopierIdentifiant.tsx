"use client";
// Copier l'identifiant complet d'une session (recette du 26/09/2026 : l'en-tête le
// tronquait en « 62cdf53f… » malgré la place, sans moyen de le reprendre pour une
// recherche ou un ticket). Le bouton vit HORS du titre : dans le h1, son libellé
// entrerait dans le nom du titre à la lecture d'écran.
import { useState } from "react";

export function CopierIdentifiant({ valeur }: { valeur: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valeur);
          setCopie(true);
          setTimeout(() => setCopie(false), 1500);
        } catch {
          // Presse-papiers refusé (contexte non sécurisé, permission) : l'identifiant
          // du titre reste sélectionnable à la main.
        }
      }}
      className="btn-ghost border border-line px-2 py-1 text-xs"
      data-testid="copier-identifiant"
    >
      {copie ? "Identifiant copié" : "Copier l'identifiant"}
    </button>
  );
}
