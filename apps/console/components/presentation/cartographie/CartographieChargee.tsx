"use client";

// La carte ne se rend que dans le navigateur : React Flow mesure ses nœuds dans le
// DOM, et son code n'a rien à faire dans le rendu serveur ni dans les autres pages.
// En attendant, un cadre de la même taille : la page ne saute pas quand elle arrive.
// La version texte (InventaireCarte), rendue côté serveur, dit la même chose sans
// JavaScript.
import dynamic from "next/dynamic";

const Cartographie = dynamic(() => import("./Cartographie").then((m) => m.Cartographie), {
  ssr: false,
  loading: () => (
    <div className="carte-cadre items-center justify-center" data-testid="cartographie-chargement">
      <p className="animate-pulse text-sm text-white/50">Chargement de la carte…</p>
    </div>
  ),
});

export function CartographieChargee({ depot }: { depot: string }) {
  return <Cartographie depot={depot} />;
}
