"use client";

// Premier écran de la vitrine : le film d'accueil en plein cadre, titres incrustés au
// montage (scripts/monter-film-accueil.mjs). Dessous, toujours rendu, le même message
// en texte sur un fond animé : les fils lumineux qui montent des écrans vers la
// console. Le film ne le recouvre qu'une fois qu'il JOUE ; tant qu'il charge, ou si
// le navigateur refuse la lecture automatique (économie d'énergie, réglage du
// visiteur), c'est ce premier écran qu'on voit, pas une affiche figée.
//
// La lecture part du script, pas de l'attribut `autoPlay` : qui a demandé moins de
// mouvement ne voit jamais le film démarrer. Un film de plus de cinq secondes doit
// pouvoir s'arrêter (WCAG 2.2.2) : d'où les commandes, en icônes comme sur xsom.fr.
// Le son part coupé, seule condition de la lecture automatique ; il ne s'ouvre que
// sur le bouton, geste qui autorise aussi à lancer le film s'il était arrêté.
//
// En bas à gauche, le bouton du film de présentation (FilmPresentation) : un autre
// film, qui s'ouvre en grand et ne joue que sur demande.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FilmPresentation, type FilmDePresentation } from "./FilmPresentation";

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

/** Les icônes des commandes : tracés 24×24, trait courant. */
const ICONES = {
  lire: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  son: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  muet: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
};

function Commande({ libelle, icone, onClick, testId }: { libelle: string; icone: ReactNode; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={libelle}
      title={libelle}
      data-testid={testId}
      className="grid h-11 w-11 place-items-center rounded-full border border-white/25 bg-black/35 text-white/90 backdrop-blur-md transition hover:scale-105 hover:border-[#f89101]/70 hover:bg-black/55 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f89101]"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {icone}
      </svg>
    </button>
  );
}

export function FilmAccueil({
  film,
  presentation = null,
  suite,
}: {
  film: { mp4: string; affiche: string } | null;
  /** Le film de présentation, ouvert en grand par un bouton ; `null` : pas de bouton. */
  presentation?: FilmDePresentation | null;
  /** L'ancre de la section suivante, que vise l'invitation à descendre. */
  suite: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [enLecture, setEnLecture] = useState(false);
  /** Le film a joué au moins une image : il recouvre alors le premier écran, même en pause. */
  const [filmVisible, setFilmVisible] = useState(false);
  const [son, setSon] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Un refus du navigateur laisse le premier écran animé, et le bouton « Lire ».
    v.play().catch(() => setEnLecture(false));
  }, []);

  const lire = () => void video.current?.play().catch(() => setEnLecture(false));

  const basculerLecture = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) lire();
    else v.pause();
  };

  const basculerSon = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setSon(!v.muted);
    if (!v.muted && v.paused) lire();
  };

  return (
    <section
      aria-labelledby="vitrine-titre"
      data-testid="vitrine-film"
      data-film={filmVisible ? "visible" : "attente"}
      className="relative isolate flex h-[100svh] min-h-[34rem] flex-col overflow-hidden bg-[#040a1c] text-white"
    >
      <div className="absolute inset-0 -z-20">
        <FondAnime />
      </div>
      {film && (
        <video
          ref={video}
          muted
          loop
          playsInline
          preload="auto"
          poster={film.affiche}
          aria-hidden
          onPlaying={() => {
            setEnLecture(true);
            setFilmVisible(true);
          }}
          onPause={() => setEnLecture(false)}
          className={`absolute inset-0 -z-10 h-full w-full object-cover transition-opacity duration-700 ${filmVisible ? "opacity-100" : "opacity-0"}`}
        >
          <source src={film.mp4} type="video/mp4" />
        </video>
      )}
      {/* Voiles : la marque lisible en haut, et un fondu vers la section suivante en bas. */}
      {/* Film lancé : voiles réduits, ses titres (haut) et ses chiffres (bas) restent lisibles. */}
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 -z-10 bg-gradient-to-b from-[#040a1c]/80 to-transparent transition-all duration-700 ${filmVisible ? "h-16" : "h-40"}`} />
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 -z-10 bg-gradient-to-t from-[#040a1c] to-transparent transition-all duration-700 ${filmVisible ? "h-20" : "h-48"}`} />

      {/* La place de la barre de navigation, qui flotte au-dessus du film (NavVitrine). */}
      <div aria-hidden className="h-16 shrink-0" />

      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 sm:px-6">
        {/* Le même message que les titres du film : il s'efface quand le film les montre,
            et reste lu par les lecteurs d'écran, pour qui le film est muet. */}
        <div className={`max-w-3xl transition-opacity duration-500 ${filmVisible ? "opacity-0" : "opacity-100"}`}>
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
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl items-end justify-center px-4 pb-7 sm:px-6">
        {presentation && (
          <div className="absolute bottom-6 left-4 sm:left-6">
            <FilmPresentation film={presentation} />
          </div>
        )}
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
          <div className="absolute bottom-6 right-4 flex gap-2.5 sm:right-6">
            <Commande
              testId="vitrine-film-lecture"
              libelle={enLecture ? "Mettre le film en pause" : "Lire le film"}
              icone={enLecture ? ICONES.pause : ICONES.lire}
              onClick={basculerLecture}
            />
            <Commande
              testId="vitrine-film-son"
              libelle={son ? "Couper le son" : "Activer le son"}
              icone={son ? ICONES.son : ICONES.muet}
              onClick={basculerSon}
            />
          </div>
        )}
      </div>
    </section>
  );
}
