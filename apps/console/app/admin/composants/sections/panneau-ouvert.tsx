"use client";
// Vitrine (F07) : le panneau de démonstration ouvert par `?panel=`.
//
// POURQUOI UN COMPOSANT CLIENT ICI. La vitrine est une page sans paramètres (F03), et
// ce lot n'y ajoute qu'une ligne : la section ne reçoit donc pas les `searchParams`
// de la page. Elle lit `panel` par `useSearchParams` — rendu serveur compris, la page
// étant dynamique : le panneau est dans le HTML initial, et fonctionne sans
// JavaScript. Un vrai écran (F17, F20, F43) lit `panel` côté serveur, par
// `lireEtatDeVue`, et rend `DetailPanel` directement.
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { DetailPanel, type OngletDetail, type PuceDetail } from "@/components/DetailPanel";
import { ligneIgnoree, lirePanel, type TypePanneau } from "@/lib/view-state";

export interface PanneauDemo {
  type: Exclude<TypePanneau, "noeud">;
  id: string;
  titre: string;
  puces: PuceDetail[];
  pageHref: string;
  precedentHref: string | null;
  suivantHref: string | null;
  onglets: OngletDetail[];
  /** Rendu côté serveur, passé tel quel. */
  contenu: ReactNode;
}

export function PanneauOuvert({ fermerHref, panneaux }: { fermerHref: string; panneaux: PanneauDemo[] }) {
  const valeur = useSearchParams().get("panel");
  if (!valeur) return null;
  const lu = lirePanel(valeur);
  const ouvert = lu && lu.type !== "noeud" ? panneaux.find((p) => p.type === lu.type && p.id === lu.id) : undefined;
  if (!ouvert) {
    // Un panneau inconnu ne s'ouvre pas vide : il est ignoré, et on le dit (§ 3.1, règle 3).
    return (
      <p role="note" className="text-xs text-ink-soft">
        {ligneIgnoree("panel", valeur, "aucun élément de la démonstration ne porte cet identifiant")}
      </p>
    );
  }
  return (
    <DetailPanel
      type={ouvert.type}
      titre={ouvert.titre}
      puces={ouvert.puces}
      fermerHref={fermerHref}
      pageHref={ouvert.pageHref}
      precedentHref={ouvert.precedentHref}
      suivantHref={ouvert.suivantHref}
      onglets={ouvert.onglets}
    >
      {ouvert.contenu}
    </DetailPanel>
  );
}
