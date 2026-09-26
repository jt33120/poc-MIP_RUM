// APropos — le pied de page UNIQUE d'une figure : d'où viennent ses chiffres et
// comment les lire. Rendu serveur, sans script (un `<details>`).
//
// POURQUOI (recette du 26/09/2026). Chaque carte de tableau de bord empilait une
// fiche de provenance (« Compte : mesures reçues · 186 lignes de population ·
// agrégation non additive · source : lignes brutes… ») et un ou deux paragraphes de
// méthode, identiques d'une carte à l'autre : sept cartes faisaient 3 700 px, et la
// valeur se perdait dessous. La lecture compacte montre la valeur, son verdict et
// son graphique ; tout le reste est ici, replié, au même endroit sur chaque figure.
//
// RIEN N'EST RETIRÉ, TOUT EST RANGÉ. Le texte replié reste dans la page (lu par un
// lecteur d'écran qui ouvre le résumé, et par l'export) : la figure ne dit pas moins,
// elle le dit après le chiffre.
import type { ReactNode } from "react";

export function APropos({
  lignes,
  titre = "À propos de ces chiffres",
  className = "mt-3",
  testId = "a-propos",
}: {
  /** Une phrase par ligne ; un nœud quand une partie porte un repère de test. */
  lignes: ReactNode[];
  titre?: string;
  className?: string;
  testId?: string;
}) {
  if (lignes.length === 0) return null;
  return (
    <details className={`${className} min-w-0 text-xs text-ink-soft`} data-testid={testId}>
      <summary className="cursor-pointer select-none rounded font-medium hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
        {titre}
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
        {lignes.map((ligne, i) => (
          <li key={i} className="min-w-0 break-words">
            {ligne}
          </li>
        ))}
      </ul>
    </details>
  );
}
