// Le gabarit des pages du menu (Installation, À faire, Graphe technique) : le même
// marine que la vitrine, sa barre de navigation, un titre, puis la page.
//
// Toujours en thème sombre (classe `dark`), comme la vitrine : on passe de l'une aux
// autres sans changer de lumière. Les composants repris de l'ancien dossier technique
// suivent, puisqu'ils lisent les couleurs du thème.
import type { ReactNode } from "react";
import { Pied } from "@/components/presentation/Cadre";
import { NavVitrine } from "@/components/presentation/vitrine/NavVitrine";

export function PageVitrine({
  connecte,
  demoOuverte,
  surtitre,
  titre,
  chapeau,
  children,
  testId,
}: {
  connecte: boolean;
  demoOuverte: boolean;
  surtitre: string;
  titre: ReactNode;
  chapeau?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div className="dark vitrine flex min-h-screen flex-col bg-[#040a1c] text-ink [color-scheme:dark]">
      <NavVitrine connecte={connecte} demoOuverte={demoOuverte} />
      <main className="flex-1 pt-16" data-testid={testId}>
        <div className="relative overflow-hidden">
          <div aria-hidden className="vitrine-fond pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-16 sm:px-6 lg:pb-16 lg:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#fbbc64]">{surtitre}</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-extrabold leading-[1.02] tracking-[-0.03em] text-white sm:text-6xl">
              {titre}
            </h1>
            {chapeau && <div className="mt-5 max-w-3xl text-lg leading-relaxed text-white/70">{chapeau}</div>}
          </div>
        </div>
        {children}
      </main>
      <Pied />
    </div>
  );
}
