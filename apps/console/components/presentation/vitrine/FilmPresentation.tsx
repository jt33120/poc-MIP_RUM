"use client";

// LE FILM DE PRÉSENTATION (01/10/2026) : une minute et demie qui dit le produit, sa
// différence et sa stack. Il ne remplace pas le film d'accueil, il a sa propre place :
// le film d'accueil est un fond muet de quinze secondes, que l'en-tête et l'invitation
// « Entrer » recouvrent en haut et en bas ; celui-ci porte des schémas, des chiffres et
// des phrases qu'il faut lire en entier, dans l'ordre, et qu'on doit pouvoir arrêter.
// D'où un bouton, et une lecture plein cadre avec les commandes du navigateur.
//
// La vidéo n'est montée qu'à l'ouverture : la page ne la télécharge pas pour rien, et
// rien ne démarre sans un geste du visiteur. Exception voulue : l'adresse
// /presentation#film ouvre la fenêtre directement (lien à donner en réunion) ; le film
// y attend alors le bouton « Lecture » si le navigateur refuse de le lancer.
//
// Fenêtre <dialog> native, comme components/perf/BoutonFenetre.tsx : le focus y entre
// et en revient, Échap la ferme, un clic sur le voile aussi.
import { useCallback, useEffect, useRef, useState } from "react";

export type FilmDePresentation = { mp4: string; affiche: string; duree: string };

export function FilmPresentation({ film }: { film: FilmDePresentation }) {
  const fenetre = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ouvert, setOuvert] = useState(false);

  const ouvrir = useCallback(() => {
    setOuvert(true);
    if (!fenetre.current?.open) fenetre.current?.showModal();
  }, []);

  useEffect(() => {
    if (window.location.hash === "#film") ouvrir();
  }, [ouvrir]);

  useEffect(() => {
    if (!ouvert) return;
    // Le geste d'ouverture autorise la lecture ; un refus laisse les commandes.
    void video.current?.play().catch(() => undefined);
  }, [ouvert]);

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        aria-haspopup="dialog"
        aria-label={`Voir le film de présentation (${film.duree})`}
        data-testid="vitrine-film-presentation"
        className="group flex h-11 items-center gap-2.5 rounded-full border border-[#f89101]/60 bg-[#040a1c]/55 pl-1.5 pr-1.5 text-sm font-semibold text-white backdrop-blur-md transition hover:border-[#f89101] hover:bg-[#040a1c]/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f89101] sm:pr-4"
      >
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#fca62b] to-[#d97b00] text-[#040a1c] transition group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor">
            <path d="M8 5.5v13l10.5-6.5z" />
          </svg>
        </span>
        <span className="hidden sm:inline">Voir le film</span>
        <span className="hidden text-white/60 sm:inline">{film.duree}</span>
      </button>

      <dialog
        ref={fenetre}
        aria-label="Film de présentation de MIP RUM"
        data-testid="vitrine-film-presentation-fenetre"
        onClose={() => {
          video.current?.pause();
          setOuvert(false);
        }}
        // Un clic sur le voile (hors de la vidéo) ferme : c'est le <dialog> lui-même.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="w-[min(calc(100vw-2rem),calc((100svh-5rem)*16/9))] overflow-visible rounded-2xl bg-transparent p-0 text-white backdrop:bg-[#040a1c]/85 backdrop:backdrop-blur-sm"
      >
        <div className="relative overflow-hidden rounded-2xl bg-[#040a1c] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10">
          {ouvert && (
            <video ref={video} controls playsInline preload="auto" poster={film.affiche} className="block aspect-video h-auto w-full">
              <source src={film.mp4} type="video/mp4" />
            </video>
          )}
        </div>
        <button
          type="button"
          onClick={() => fenetre.current?.close()}
          aria-label="Fermer le film"
          className="absolute -top-3 -right-3 grid h-10 w-10 place-items-center rounded-full border border-white/25 bg-[#040a1c] text-white/90 shadow-lg transition hover:border-[#f89101]/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f89101]"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </dialog>
    </>
  );
}
