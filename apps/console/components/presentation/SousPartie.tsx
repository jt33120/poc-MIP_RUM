// Sous-partie d'une partie de la vitrine : une section, son titre `h3` et, au
// besoin, un surtitre et un chapeau. Rendu serveur, sans état.
//
// La partie porte le `h2` (Partie.tsx) ; ses blocs sont des `h3`, leurs cartes des
// `h4`. Un seul gabarit pour que les blocs de « Ce qu'il contient » (P**.3) aient
// tous le même titre, et qu'un lecteur d'écran y retrouve la hiérarchie de la page.
import type { ReactNode } from "react";

export function SousPartie({
  id,
  titre,
  surtitre,
  chapeau,
  children,
}: {
  /** Identifiant de la section ; son titre porte `${id}-titre`. */
  id: string;
  titre: ReactNode;
  surtitre?: string;
  chapeau?: ReactNode;
  children: ReactNode;
}) {
  const titreId = `${id}-titre`;
  return (
    <section id={id} aria-labelledby={titreId} className="min-w-0">
      {surtitre && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-perf">{surtitre}</p>
      )}
      <h3 id={titreId} className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">
        {titre}
      </h3>
      {chapeau && <p className="mt-2 max-w-3xl leading-relaxed text-ink-soft">{chapeau}</p>}
      {children}
    </section>
  );
}
