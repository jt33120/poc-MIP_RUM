"use client";
// Surtitre d'en-tête de page : la CATÉGORIE de navigation qui range l'écran
// (plan § 2.4, F09), pour que l'en-tête et la sidebar disent le même mot.
//
// Client parce qu'il lit le chemin : sans `domain` explicite, la page prend le
// domaine de sa catégorie (`domaineDe`). Sans cela, chaque écran rangé ailleurs
// que sous « Performance » aurait affiché « Performance » jusqu'à ce que son lot
// le reprenne — l'en-tête aurait contredit la navigation.
import { usePathname } from "next/navigation";
import { domaineDe } from "./nav-items";

// Code couleur constant : bleu = mesure de l'expérience vécue (les cinq
// catégories RUM), violet = intelligence artificielle.
const RUM = { dot: "bg-perf", text: "text-perf" } as const;
export const DOMAINES = {
  perf: { label: "Performance", ...RUM },
  robot: { label: "Robot et réel", ...RUM },
  usages: { label: "Usages", ...RUM },
  fiabilite: { label: "Fiabilité", ...RUM },
  explorer: { label: "Explorer", ...RUM },
  ai: { label: "Intelligence artificielle", dot: "bg-ai", text: "text-ai" },
} as const;

export type PageDomain = keyof typeof DOMAINES;

export function SurtitreDomaine({ domain }: { domain?: PageDomain }) {
  // usePathname peut rendre null hors du routeur (rendu isolé en test) : repli « perf ».
  const pathname = usePathname();
  const d = DOMAINES[domain ?? domaineDe(pathname ?? "") ?? "perf"];
  return (
    <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${d.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
      {d.label}
    </div>
  );
}
