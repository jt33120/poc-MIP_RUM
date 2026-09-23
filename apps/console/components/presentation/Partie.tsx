// Gabarit commun des parties de la vitrine : une section, son titre `h2` et son
// chapeau, puis ce que la partie contient. Rendu serveur, sans état.
//
// Le titre est la cible du sommaire (lib/presentation-parties.ts) : `tabIndex={-1}`
// pour que la navigation vers l'ancre y place le focus, `scroll-mt` pour qu'il ne
// colle pas au bord. L'anneau de focus est celui de la console (`ring-perf`).
import type { ReactNode } from "react";
import { idTitre, partie, type PartieId } from "@/lib/presentation-parties";

export function Partie({
  id,
  chapeau,
  children,
}: {
  id: PartieId;
  chapeau: ReactNode;
  children?: ReactNode;
}) {
  const p = partie(id);
  return (
    <section id={p.id} aria-labelledby={idTitre(p.id)} className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
        <header className="max-w-3xl">
          <h2
            id={idTitre(p.id)}
            tabIndex={-1}
            className="scroll-mt-6 rounded-md text-2xl font-bold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf sm:text-3xl"
          >
            {p.titre}
          </h2>
          <p className="mt-3 leading-relaxed text-ink-soft">{chapeau}</p>
        </header>
        {children}
      </div>
    </section>
  );
}
