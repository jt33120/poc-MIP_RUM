"use client";
// LES EMPLACEMENTS DE LA COQUILLE — la place libre d'une rangée de la coquille, offerte
// à ce que l'écran rend (recette du 01/10/2026 : « surtout pas de blanc »).
//
// La rangée des onglets n'occupe qu'une moitié de la largeur, la barre de segment
// guère plus ; l'écran, lui, empilait au-dessus de son contenu des rangées presque
// vides : le bouton de l'assistant seul à gauche, la rangée des vues, le bandeau « En
// bref », les actions d'un titre qui redisait l'onglet. Ils se rangent désormais dans
// la place libre de la coquille :
//   · `onglets` — à droite des onglets : le bref, l'aide et les actions de l'écran,
//     l'assistant ;
//   · `vues` — dans la barre de segment, à droite de « + Filtre » : les vues.
//
// POURQUOI UN MAGASIN, ET PAS `document.getElementById`. L'hôte n'est DÉCLARÉ qu'au
// commit de la coquille, donc une fois qu'elle est hydratée. Un portail ouvert plus tôt
// écrirait dans un nœud que React n'a pas encore repris, et l'hydratation de la
// coquille le viderait (ou rendrait sa frontière au client, hôte compris).
//
// AVANT L'HYDRATATION. Le rendu serveur ne connaît pas l'hôte : l'élément est rendu à
// sa place, dans un repli `data-repli` que la feuille de style masque quand la coquille
// porte l'hôte (fin de `app/globals.css`). Rien ne s'affiche dans la page puis n'en
// disparaît : elle ne saute pas à l'hydratation — et le rendu serveur (tests compris)
// garde le contenu.
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { ongletExact } from "./nav-items";

export type NomEmplacement = "onglets" | "vues";

const hotes = new Map<NomEmplacement, HTMLElement>();
const abonnes = new Set<() => void>();

function prevenir() {
  for (const f of abonnes) f();
}

function abonner(f: () => void) {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}

/**
 * La référence de l'élément-hôte. Une fonction STABLE par emplacement : une nouvelle
 * à chaque rendu de la coquille la ferait détacher puis rattacher — l'hôte disparaîtrait
 * un instant, et chaque portail avec lui. Le nettoyage ne retire l'hôte que s'il est
 * encore le sien (mode strict, changement d'écran).
 */
function creerRef(nom: NomEmplacement): Ref<HTMLDivElement> {
  return (el: HTMLDivElement | null) => {
    if (!el) return;
    hotes.set(nom, el);
    prevenir();
    return () => {
      if (hotes.get(nom) === el) hotes.delete(nom);
      prevenir();
    };
  };
}

const REFS: Record<NomEmplacement, Ref<HTMLDivElement>> = { onglets: creerRef("onglets"), vues: creerRef("vues") };

/** La référence à poser sur l'élément-hôte, rendu par la coquille. */
export function refHote(nom: NomEmplacement): Ref<HTMLDivElement> {
  return REFS[nom];
}

/** L'hôte déclaré, ou `null` : rendu serveur, hydratation, ou coquille sans cette rangée. */
export function useEmplacement(nom: NomEmplacement): HTMLElement | null {
  return useSyncExternalStore(
    abonner,
    () => hotes.get(nom) ?? null,
    () => null,
  );
}

/** Abonnement STABLE par largeur : une fonction neuve à chaque rendu ferait se
 *  désabonner puis se réabonner `useSyncExternalStore` à chaque rendu de l'écran. */
const ABONNEMENTS_LARGEUR = new Map<number, (f: () => void) => () => void>();
function abonnerLargeur(px: number) {
  let a = ABONNEMENTS_LARGEUR.get(px);
  if (!a) {
    a = (f: () => void) => {
      const m = window.matchMedia(`(min-width: ${px}px)`);
      m.addEventListener("change", f);
      return () => m.removeEventListener("change", f);
    };
    ABONNEMENTS_LARGEUR.set(px, a);
  }
  return a;
}

/** `true` à partir de `px` de large ; `false` au rendu serveur et pendant l'hydratation. */
export function useLargeurMin(px: number): boolean {
  return useSyncExternalStore(
    abonnerLargeur(px),
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => false,
  );
}

/** L'écran courant est-il celui d'un onglet (son titre redirait l'onglet allumé) ? */
export function useOngletExact(): boolean {
  return ongletExact(usePathname() ?? "") !== undefined;
}

/**
 * Rend `children` dans l'emplacement `vers` quand la coquille l'offre ; sinon à sa
 * place, dans le repli `repli`. `des` : largeur à partir de laquelle l'élément quitte sa
 * place — en dessous, il reste dans la page (à 390 px, la rangée des onglets n'a pas de
 * place libre).
 *
 * LA FEUILLE DE STYLE TIENT LA MÊME RÈGLE (fin de `app/globals.css`) : à partir de
 * `des`, quand la coquille rend l'hôte, le repli est masqué dès le rendu serveur. Sans
 * elle, l'élément s'afficherait dans la page puis sauterait dans la coquille à
 * l'hydratation. Un `repli` nouveau y prend sa règle, à la même largeur.
 *
 * `ordre` : rang dans l'emplacement. Les portails s'y rangent dans l'ordre où ils se
 * montent, pas dans celui qu'on lit : le bref, puis l'aide et les actions, puis
 * l'assistant au bord droit.
 */
export function Deporte({
  vers,
  repli,
  des,
  ordre = 0,
  className,
  classeDepot = "",
  children,
}: {
  vers: NomEmplacement;
  repli: string;
  des?: number;
  ordre?: number;
  className?: string;
  /** Classes du dépôt, dans l'emplacement (l'élément y prend une autre mise en forme). */
  classeDepot?: string;
  children: ReactNode;
}) {
  const hote = useEmplacement(vers);
  const large = useLargeurMin(des ?? 0);
  if (hote !== null && (des === undefined || large)) {
    return createPortal(
      <div data-depot={repli} style={{ order: ordre }} className={`flex min-w-0 items-center gap-2 ${classeDepot}`}>
        {children}
      </div>,
      hote,
    );
  }
  return (
    <div data-repli={repli} className={className}>
      {children}
    </div>
  );
}
