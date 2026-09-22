"use client";
// Îlot clavier de `FriseEtats` (F56, plan § 4.2) : UN seul arrêt de tabulation pour
// toute la frise, flèches gauche / droite (et Début / Fin) de case en case, et une
// ligne qui écrit la case active — l'infobulle du clavier, que `<title>` n'offre
// qu'au survol. Le dessin reste rendu serveur : il arrive ici en `children`.
//
// Seules les cases de la couche VISIBLE comptent (la couche détaillée ou la couche
// regroupée, choisie par une requête de conteneur) : une case d'une couche masquée
// n'a pas de boîte.
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export function FriseEtatsClavier({ children }: { children: ReactNode }) {
  const racine = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);

  const cases = (): Element[] =>
    [...(racine.current?.querySelectorAll("[data-case]") ?? [])].filter((el) => el.getClientRects().length > 0);

  const allerA = (liste: Element[], i: number) => {
    const cible = liste[Math.min(Math.max(i, 0), liste.length - 1)] as HTMLElement | SVGElement | undefined;
    if (!cible) return;
    for (const el of liste) el.setAttribute("tabindex", el === cible ? "0" : "-1");
    cible.focus();
  };

  const clavier = (e: KeyboardEvent<HTMLDivElement>) => {
    const liste = cases();
    const i = liste.indexOf(document.activeElement as Element);
    if (i < 0) return;
    const saut: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: liste.length - 1 };
    if (!(e.key in saut)) return;
    e.preventDefault();
    allerA(liste, saut[e.key]);
  };

  return (
    <div
      ref={racine}
      onKeyDown={clavier}
      onFocus={(e) => setActive((e.target as Element).getAttribute?.("aria-label") ?? null)}
      onBlur={() => setActive(null)}
      className="min-w-0"
    >
      {children}
      <p aria-hidden="true" className="min-h-[1rem] truncate text-[11px] text-ink-soft" data-testid="frise-etats-active">
        {active ?? ""}
      </p>
    </div>
  );
}
