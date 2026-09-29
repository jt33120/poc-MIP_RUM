"use client";
// Surtitre d'en-tête de page : la CATÉGORIE de navigation qui range l'écran
// (plan § 2.4, F09), pour que l'en-tête et la sidebar disent le même mot.
//
// Client parce qu'il lit le chemin : sans `domain` explicite, la page prend le
// domaine de sa catégorie, ou de sa zone hors RUM (`surtitreDe`). Sans cela,
// chaque écran rangé ailleurs que sous « Performance » affichait « Performance » :
// toute l'administration, « API et MCP », Logs et IA (recette du 26/09/2026).
import { usePathname } from "next/navigation";
import { surtitreDe } from "./nav-items";

// Code couleur constant : bleu = mesure de l'expérience vécue (les cinq
// catégories RUM), violet = intelligence artificielle, neutre = ce qui n'est pas
// une mesure (administration, intégrations, écrans fermés).
const RUM = { dot: "bg-perf", text: "text-perf" } as const;
const NEUTRE = { dot: "bg-ink-faint", text: "text-ink-soft" } as const;
export const DOMAINES = {
  perf: { label: "Performance", ...RUM },
  robot: { label: "Robot et réel", ...RUM },
  usages: { label: "Usages", ...RUM },
  fiabilite: { label: "Fiabilité", ...RUM },
  explorer: { label: "Explorer", ...RUM },
  ai: { label: "Intelligence artificielle", dot: "bg-ai", text: "text-ai" },
  admin: { label: "Administration", ...NEUTRE },
  integrations: { label: "Intégrations", ...NEUTRE },
  logs: { label: "Logs", ...NEUTRE },
} as const;

export type PageDomain = keyof typeof DOMAINES;

export function SurtitreDomaine({ domain, titre }: { domain?: PageDomain; titre?: string }) {
  // usePathname peut rendre null hors du routeur (rendu isolé en test) : repli « perf ».
  const pathname = usePathname();
  const d = DOMAINES[domain ?? surtitreDe(pathname ?? "") ?? "perf"];
  // Un surtitre qui redit le titre n'apporte rien : « Explorer » s'écrivait quatre
  // fois en haut de l'Explorer (recette du 26/09/2026). L'onglet actif et le titre suffisent.
  if (titre !== undefined && titre.trim().toLowerCase() === d.label.toLowerCase()) return null;
  return (
    <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${d.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
      {d.label}
    </div>
  );
}
