"use client";

// FicheMesure — une case de la grille du tableau de bord, et la fenêtre qu'elle
// ouvre (recette du 30/09/2026). La case ne montre que la valeur ; un clic (ou
// Entrée) ouvre, DANS la page, un <dialog> natif : graphique grand format, détail
// de la mesure, sources. Le contenu est rendu par le serveur et passé en enfants :
// ce composant ne porte que l'ouverture et la fermeture.
//
// <dialog> natif plutôt qu'une fenêtre maison : le focus y entre et en revient, Échap
// ferme, et le reste de la page devient inerte — sans une ligne de code pour cela.
import { useRef, type ReactNode } from "react";

export function FicheMesure({
  case: contenuCase,
  titre,
  ariaLabel,
  alerte = false,
  testId = "kpi-tile",
  fond,
  children,
}: {
  /** Ce que la case montre : libellé, valeur, unité. */
  case: ReactNode;
  titre: string;
  /** Le libellé complet annoncé par un lecteur d'écran (valeur, verdict, delta…). */
  ariaLabel: string;
  alerte?: boolean;
  testId?: string;
  /** L'aperçu de la courbe, dessiné derrière le contenu de la case. */
  fond?: ReactNode;
  children: ReactNode;
}) {
  const fenetre = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => fenetre.current?.showModal()}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        data-testid={testId}
        data-ton={alerte ? "bad" : "neutre"}
        className={`relative isolate flex h-full min-h-[6.5rem] w-full min-w-0 flex-col justify-between gap-1 overflow-hidden rounded-xl border bg-panel px-3.5 py-3 text-left transition hover:border-ink-faint/60 hover:bg-panel2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
          alerte ? "border-bad/50" : "border-line"
        }`}
      >
        {fond}
        <span className="relative z-10 flex h-full min-w-0 flex-col justify-between gap-1">{contenuCase}</span>
      </button>
      <dialog
        ref={fenetre}
        aria-label={titre}
        // Un clic sur le voile (hors de la boîte) ferme : c'est le <dialog> lui-même.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="w-[min(46rem,calc(100vw-2rem))] rounded-2xl border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]"
      >
        <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-sm font-semibold text-ink">{titre}</h2>
            <button
              type="button"
              onClick={() => fenetre.current?.close()}
              aria-label="Fermer"
              className="-m-1 rounded-lg p-1 text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
