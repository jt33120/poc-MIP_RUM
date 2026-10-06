// Deuxième écran de la vitrine (06/10/2026) : « Comment ça marche ? », la vidéo qui
// explique la technique, chapitre par chapitre — des capteurs à la console, le nettoyage
// des données, les travaux planifiés, et ce qui reste à trancher. Elle vient avant les
// entrées : on comprend d'abord, on entre ensuite.
//
// Six minutes qu'on lit, qu'on arrête et qu'on reprend : une vidéo dans la page, avec
// les commandes du navigateur, jamais en lecture automatique. `preload="none"` : la page
// ne télécharge rien tant que le visiteur ne lance pas la lecture ; l'affiche suffit.
//
// Source : un projet Remotion hors dépôt (poc-MIP_RUM/local/video-technique-rum), dont
// le texte suit celui du projet ; le fichier servi ici en est l'encodage pour le web.
import { SectionDefilee } from "./SectionDefilee";

export type FilmTechnique = { mp4: string; affiche: string; duree: string };

export function CommentCaMarche({ id, film }: { id: string; film: FilmTechnique }) {
  return (
    <SectionDefilee
      id={id}
      aria-labelledby={`${id}-titre`}
      data-testid="vitrine-comment"
      className="flex min-h-[100svh] flex-col justify-center px-4 py-16 sm:px-6"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="entrees-piece" style={{ ["--i" as string]: 0 }}>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">La technique, en {film.duree}</p>
          <h2 id={`${id}-titre`} className="mt-3 text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl">
            Comment ça marche ?
          </h2>
          <p className="mt-4 max-w-2xl text-base text-white/70 sm:text-lg">
            Du navigateur du visiteur à la console : ce que mesurent les capteurs, comment les données sont reçues,
            nettoyées et rangées, ce que calculent les travaux planifiés, et ce qui reste à trancher.
          </p>
        </div>
        <div className="entrees-piece mt-8" style={{ ["--i" as string]: 1 }}>
          <video
            controls
            playsInline
            preload="none"
            poster={film.affiche}
            data-testid="vitrine-comment-video"
            aria-label={`Comment ça marche ? La technique de MIP RUM, en ${film.duree}`}
            className="block aspect-video h-auto w-full rounded-2xl bg-[#040a1c] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
          >
            <source src={film.mp4} type="video/mp4" />
          </video>
        </div>
      </div>
    </SectionDefilee>
  );
}
