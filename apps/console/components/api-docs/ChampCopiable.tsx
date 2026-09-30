"use client";
// Une valeur sur UNE ligne (adresse, commande) et son bouton « Copier ».
//
// Le bloc de code sombre (`CopyBlock`) prenait quatre lignes pour une adresse ; ici
// la valeur tient sur sa ligne et défile DANS son champ quand elle est plus longue
// que lui — jamais la page (390 px). La valeur reste sélectionnable à la main si le
// presse-papiers est refusé (contexte non sécurisé, permission).
import { useState } from "react";

export function ChampCopiable({ valeur, libelle, testId }: { valeur: string; libelle: string; testId?: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <div className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-line bg-panel2" data-testid={testId}>
      <code
        className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2.5 py-1.5 font-mono text-xs leading-5 text-ink"
        aria-label={libelle}
        tabIndex={0}
      >
        {valeur}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(valeur);
            setCopie(true);
            setTimeout(() => setCopie(false), 1500);
          } catch {
            // Presse-papiers refusé : la valeur reste sélectionnable dans son champ.
          }
        }}
        className="shrink-0 border-l border-line bg-panel px-2.5 text-xs font-medium text-ink-soft transition hover:bg-app hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf"
        aria-label={copie ? `${libelle} copiée` : `Copier : ${libelle}`}
      >
        <span aria-hidden>{copie ? "Copié ✓" : "Copier"}</span>
      </button>
    </div>
  );
}
