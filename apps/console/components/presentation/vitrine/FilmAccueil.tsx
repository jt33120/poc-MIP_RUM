"use client";

// Premier écran de la vitrine : le film d'accueil en plein cadre, titres incrustés au
// montage (scripts/monter-film-accueil.mjs). Tant qu'aucun film n'est monté
// (FILM_ACCUEIL vaut null), le même message s'écrit en texte sur un fond animé : les
// fils lumineux qui montent des écrans vers la console, l'idée même du film.
//
// La lecture part du script, pas de l'attribut `autoPlay` : qui a demandé moins de
// mouvement ne voit jamais le film démarrer, seulement son affiche. Un film qui dure
// plus de cinq secondes doit pouvoir s'arrêter (WCAG 2.2.2) : d'où le bouton pause.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Les fils du fond animé : départ en bas du cadre, arrivée au foyer, à droite du titre. */
const FILS = Array.from({ length: 16 }, (_, i) => {
  const x = 40 + i * 62;
  const foyerX = 760;
  const foyerY = 250;
  return {
    d: `M ${x} 640 C ${x} ${480 - (i % 4) * 30}, ${foyerX + (x - foyerX) * 0.35} ${foyerY + 150}, ${foyerX} ${foyerY}`,
    delai: `${(i * 0.37) % 3.2}s`,
    duree: `${4.6 + (i % 5) * 0.55}s`,
  };
});

function FondAnime() {
  return (
    <div aria-hidden className="absolute inset-0">
      <div className="vitrine-fond absolute inset-0" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 640"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id="vitrine-fil" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#f89101" stopOpacity="0" />
            <stop offset="0.55" stopColor="#f89101" stopOpacity="0.45" />
            <stop offset="1" stopColor="#fbbc64" stopOpacity="0.95" />
          </linearGradient>
          <radialGradient id="vitrine-foyer">
            <stop offset="0" stopColor="#fca62b" stopOpacity="0.9" />
            <stop offset="0.35" stopColor="#f89101" stopOpacity="0.25" />
            <stop offset="1" stopColor="#f89101" stopOpacity="0" />
          </radialGradient>
        </defs>
        {FILS.map((f) => (
          <path key={f.d} d={f.d} stroke="rgba(248,145,1,0.10)" strokeWidth="1" />
        ))}
        {FILS.map((f) => (
          <path
            key={`anime-${f.d}`}
            d={f.d}
            className="vitrine-fil"
            stroke="url(#vitrine-fil)"
            strokeWidth="1.6"
            strokeLinecap="round"
            pathLength={100}
            style={{ animationDelay: f.delai, animationDuration: f.duree }}
          />
        ))}
        <circle cx="760" cy="250" r="90" fill="url(#vitrine-foyer)" className="vitrine-foyer" />
      </svg>
    </div>
  );
}

export function FilmAccueil({
  film,
  entete,
  suite,
}: {
  film: { mp4: string; affiche: string } | null;
  /** La marque, posée sur le film. */
  entete: ReactNode;
  /** L'ancre de la section suivante, que vise l'invitation à descendre. */
  suite: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [enLecture, setEnLecture] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Un refus du navigateur (économie d'énergie, lecture automatique bloquée) laisse
    // l'affiche et le bouton « Lire » : rien à signaler de plus.
    v.play().then(
      () => setEnLecture(true),
      () => setEnLecture(false),
    );
  }, []);

  const basculer = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setEnLecture(true), () => setEnLecture(false));
    else {
      v.pause();
      setEnLecture(false);
    }
  };

  return (
    <section
      aria-labelledby="vitrine-titre"
      data-testid="vitrine-film"
      className="relative isolate flex h-[100svh] min-h-[34rem] flex-col overflow-hidden bg-[#040a1c] text-white"
    >
      {film ? (
        <video
          ref={video}
          muted
          loop
          playsInline
          preload="auto"
          poster={film.affiche}
          aria-hidden
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        >
          <source src={film.mp4} type="video/mp4" />
        </video>
      ) : (
        <div className="absolute inset-0 -z-10">
          <FondAnime />
        </div>
      )}
      {/* Voiles : la marque lisible en haut, et un fondu vers la section suivante en bas. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-[#040a1c]/80 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[#040a1c] to-transparent" />

      <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-5 sm:px-6">{entete}</header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 sm:px-6">
        {film ? (
          // Les titres sont dans l'image : le h1 les redit pour qui ne la voit pas.
          <h1 id="vitrine-titre" className="sr-only">
            MIP RUM : voir ce que vivent vraiment les visiteurs d&apos;un site ou d&apos;une application.
          </h1>
        ) : (
          <div className="max-w-3xl">
            <p className="vitrine-ligne text-xs font-semibold uppercase tracking-[0.28em] text-[#fbbc64]">
              <span style={{ ["--d" as string]: "0.05s" }}>MIP RUM · Real User Monitoring</span>
            </p>
            <h1 id="vitrine-titre" className="mt-5 text-5xl font-extrabold leading-[0.98] tracking-[-0.035em] sm:text-7xl lg:text-8xl">
              <span className="vitrine-ligne block">
                <span style={{ ["--d" as string]: "0.15s" }}>Voir ce que vivent</span>
              </span>
              <span className="vitrine-ligne block">
                <span
                  style={{ ["--d" as string]: "0.3s" }}
                  className="bg-gradient-to-r from-[#fbbc64] via-[#f89101] to-[#d97b00] bg-clip-text text-transparent"
                >
                  vos vrais visiteurs.
                </span>
              </span>
            </h1>
            <p className="vitrine-ligne mt-6 max-w-xl text-lg leading-relaxed text-white/75 sm:text-xl">
              <span style={{ ["--d" as string]: "0.5s" }}>
                Vitesse d&apos;affichage, erreurs et parcours, mesurés dans leurs propres navigateurs.
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl items-end justify-center px-4 pb-7 sm:px-6">
        <a
          href={`#${suite}`}
          className="group flex flex-col items-center gap-1.5 text-xs font-medium uppercase tracking-[0.24em] text-white/70 transition hover:text-white"
        >
          Entrer
          <svg aria-hidden viewBox="0 0 24 24" className="vitrine-descendre h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </a>
        {film && (
          <button
            type="button"
            onClick={basculer}
            aria-pressed={!enLecture}
            className="absolute bottom-6 right-4 rounded-full border border-white/25 bg-black/30 px-3.5 py-1.5 text-xs font-medium text-white/85 backdrop-blur-sm transition hover:bg-black/50 sm:right-6"
          >
            {enLecture ? "Pause" : "Lire le film"}
          </button>
        )}
      </div>
    </section>
  );
}
