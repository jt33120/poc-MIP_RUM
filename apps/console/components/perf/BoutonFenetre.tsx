"use client";

// BoutonFenetre — un lien d'une ligne qui ouvre une fenêtre (recette du 30/09/2026).
//
// POURQUOI. Les écrans de performance posaient à plat ce qui ne se lit qu'une fois :
// le mode d'emploi d'un module à installer (un paragraphe et un bloc de code), la
// matrice des capacités d'un capteur, la méthode d'un classement. Le responsable :
// « le reste en ouvrant la case ». La ligne dit l'essentiel en quelques mots ; le
// détail s'ouvre ici, DANS la page, sans la quitter.
//
// Même fenêtre que `FicheMesure` (un <dialog> natif : le focus y entre et en revient,
// Échap ferme, le reste de la page devient inerte), mais ouverte par un bouton-lien
// posé dans une ligne de texte, pas par une case de la grille. Le contenu est rendu
// par le serveur et passé en enfants : il reste dans le document (lu par les tests
// qui cherchent un texte), hors de l'arbre d'accessibilité tant que la fenêtre est fermée.
import { useRef, type ReactNode } from "react";

export function BoutonFenetre({
  libelle,
  titre,
  testId,
  className = "",
  large = false,
  children,
}: {
  /** Le texte du bouton (« Installer → », « Détail »). */
  libelle: ReactNode;
  /** Le titre de la fenêtre, et son nom accessible. */
  titre: string;
  testId?: string;
  className?: string;
  /** Fenêtre large (tableau, matrice) : 64 rem au lieu de 46. */
  large?: boolean;
  children: ReactNode;
}) {
  const fenetre = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => fenetre.current?.showModal()}
        aria-haspopup="dialog"
        data-testid={testId}
        className={`shrink-0 rounded text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${className}`}
      >
        {libelle}
      </button>
      <dialog
        ref={fenetre}
        aria-label={titre}
        // Un clic sur le voile (hors de la boîte) ferme : c'est le <dialog> lui-même.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className={`${large ? "w-[min(64rem,calc(100vw-2rem))]" : "w-[min(46rem,calc(100vw-2rem))]"} rounded-2xl border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]`}
      >
        <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
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
          <div className="text-sm leading-relaxed text-ink-soft">{children}</div>
        </div>
      </dialog>
    </>
  );
}
