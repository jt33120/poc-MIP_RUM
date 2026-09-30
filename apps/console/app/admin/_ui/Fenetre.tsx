"use client";
// Un formulaire d'administration EN FENÊTRE (refonte du 01/10/2026) : un bouton dans
// l'en-tête de la page (« Ajouter une application »), qui ouvre un <dialog> natif.
//
// POURQUOI. Les formulaires de création occupaient une carte pleine largeur en tête
// de chaque écran (jusqu'à 250 px) : la liste — ce qu'on vient consulter — passait
// sous la ligne de flottaison. Le formulaire sert une fois ; la liste, à chaque visite.
//
// <dialog> natif, comme `FicheMesure` : le focus y entre et en revient, Échap ferme,
// le reste de la page devient inerte. Le contenu (le formulaire et ses server
// actions) est rendu tel quel en enfant : rien ne change de ce qu'il envoie.
//
// `fermerALEnvoi` : la fenêtre se ferme quand un formulaire qu'elle contient part
// (l'évènement `submit` n'a lieu qu'après la validation du navigateur). La page relue
// montre alors le résultat : la ligne ajoutée, l'erreur, ou le secret affiché une
// seule fois en tête de page. SANS lui, la fenêtre reste ouverte : pour un formulaire
// qui affiche lui-même son résultat (le secret d'un jeton de CI, sous le formulaire).
//
// `ouverteAuDepart` : arrivée par un lien qui demande ce formulaire (« accès client »
// depuis la fiche d'une application, `?app=`) — la fenêtre s'ouvre, préremplie.
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Fenetre({
  libelle,
  titre,
  children,
  testId,
  ouverteAuDepart = false,
  fermerALEnvoi = false,
  variante = "accent",
  large = false,
}: {
  /** Libellé du bouton qui ouvre la fenêtre. */
  libelle: ReactNode;
  /** Titre de la fenêtre (son nom accessible). */
  titre: string;
  children: ReactNode;
  /** `data-testid` du bouton ; la fenêtre porte `<testId>-fenetre`. */
  testId?: string;
  ouverteAuDepart?: boolean;
  fermerALEnvoi?: boolean;
  variante?: "accent" | "discret";
  /** 48 rem au lieu de 34 : un formulaire à plusieurs colonnes. */
  large?: boolean;
}) {
  const fenetre = useRef<HTMLDialogElement>(null);
  const idTitre = useId();

  useEffect(() => {
    const d = fenetre.current;
    if (ouverteAuDepart && d && !d.open) d.showModal();
  }, [ouverteAuDepart]);

  return (
    <>
      <button
        type="button"
        onClick={() => fenetre.current?.showModal()}
        aria-haspopup="dialog"
        data-testid={testId}
        className={`${variante === "accent" ? "btn-accent" : "btn-ghost"} inline-flex items-center gap-1.5 whitespace-nowrap`}
      >
        <span aria-hidden className="text-base leading-none">
          +
        </span>
        {libelle}
      </button>
      <dialog
        ref={fenetre}
        aria-labelledby={idTitre}
        data-testid={testId ? `${testId}-fenetre` : undefined}
        // Un clic sur le voile (hors de la boîte) ferme : c'est le <dialog> lui-même.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        onSubmit={
          fermerALEnvoi
            ? () => {
                // Après l'envoi, pas pendant : le formulaire lit ses champs d'abord.
                window.setTimeout(() => fenetre.current?.close(), 0);
              }
            : undefined
        }
        className={`${large ? "w-[min(48rem,calc(100vw-2rem))]" : "w-[min(34rem,calc(100vw-2rem))]"} rounded-2xl border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]`}
      >
        <div className="max-h-[85vh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={idTitre} className="text-sm font-semibold text-ink">
              {titre}
            </h2>
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
