"use client";
// Échap ferme la bulle d'`InfoTip` (F69, WCAG 1.4.13 « contenu au survol ou au
// focus ») : un contenu qui s'ouvre au focus ou au survol doit pouvoir être masqué
// SANS déplacer le focus ni le pointeur. La bulle s'ouvre en CSS pur ; cet îlot pose
// seulement `data-ferme` sur son groupe à l'appui d'Échap, et le retire quand le
// groupe n'est PLUS NI survolé NI focalisé : la bulle se rouvre au passage suivant.
//
// LES DEUX OUVERTURES, PAS L'UNE OU L'AUTRE (revue de fin de vague 8). La bulle
// s'ouvre au survol (`group-hover`) ET au focus (`group-focus-within`). Réarmer dès
// que le pointeur sortait rouvrait donc, sans le moindre geste, une bulle fermée
// par Échap dont le déclencheur gardait le focus clavier : focus sur l'icône,
// pointeur dessus, Échap → fermée ; le pointeur s'écarte → `group-focus-within` la
// réaffichait. Le pointeur qui sort ne réarme que si le focus n'est plus dans le
// groupe ; le focus qui sort, que si le pointeur n'est plus au-dessus.
import { useEffect, useRef } from "react";

/**
 * Branche Échap sur un groupe d'`InfoTip` ; rend la fonction qui débranche.
 * Séparée du composant pour être éprouvée sans navigateur
 * (tests/unit/InfoTipEchap.test.ts).
 */
export function brancherEchap(groupe: HTMLElement, doc: Document): () => void {
  const dansLeGroupe = (cible: EventTarget | null) => cible !== null && groupe.contains(cible as Node);
  const rearmer = () => groupe.removeAttribute("data-ferme");

  const fermer = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (dansLeGroupe(doc.activeElement) || groupe.matches(":hover")) groupe.setAttribute("data-ferme", "");
  };
  // Le pointeur s'en va : la bulle reste fermée tant que le focus y est.
  const pointeurSorti = () => {
    if (!dansLeGroupe(doc.activeElement)) rearmer();
  };
  // Le focus s'en va : un passage d'un élément du groupe à un autre ne le quitte pas,
  // et la bulle reste fermée tant que le pointeur est au-dessus.
  const focusSorti = (e: FocusEvent) => {
    if (dansLeGroupe(e.relatedTarget)) return;
    if (!groupe.matches(":hover")) rearmer();
  };

  doc.addEventListener("keydown", fermer);
  groupe.addEventListener("focusout", focusSorti);
  groupe.addEventListener("mouseleave", pointeurSorti);
  return () => {
    doc.removeEventListener("keydown", fermer);
    groupe.removeEventListener("focusout", focusSorti);
    groupe.removeEventListener("mouseleave", pointeurSorti);
  };
}

/** Un rectangle à l'écran (coordonnées de la fenêtre, comme `getBoundingClientRect`). */
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const ECART = 8;
const MARGE = 8;

/**
 * Où poser la bulle, en coordonnées de la FENÊTRE (`position: fixed`). Posée en
 * absolu dans son groupe, elle était rognée par tout ancêtre qui défile ou coupe
 * (`overflow`) : un tableau défilant, une carte `overflow-hidden`, la liste d'un
 * classement (recette du 01/10/2026). Accrochée à l'icône (`align`), du côté demandé
 * (`side`), retournée de l'autre côté si elle n'y tient pas, et toujours gardée à
 * 8 px des bords de la fenêtre.
 */
export function placerBulle(
  cible: Rect,
  bulle: { largeur: number; hauteur: number },
  vue: { largeur: number; hauteur: number },
  side: "top" | "bottom",
  align: "center" | "start" | "end",
): { x: number; y: number } {
  const brut = align === "start" ? cible.left : align === "end" ? cible.right - bulle.largeur : (cible.left + cible.right) / 2 - bulle.largeur / 2;
  const x = Math.max(MARGE, Math.min(brut, vue.largeur - bulle.largeur - MARGE));
  const dessous = cible.bottom + ECART;
  const dessus = cible.top - ECART - bulle.hauteur;
  const tientDessous = dessous + bulle.hauteur <= vue.hauteur - MARGE;
  const tientDessus = dessus >= MARGE;
  const y = side === "top" ? (tientDessus || !tientDessous ? dessus : dessous) : tientDessous || !tientDessus ? dessous : dessus;
  return { x, y: Math.max(MARGE, y) };
}

/**
 * À partir de 640 px, pose la bulle en `fixed` aux coordonnées de `placerBulle` quand
 * le groupe s'ouvre (survol, focus), et la suit pendant un défilement. En dessous, la
 * bulle reste posée au bord bas de la fenêtre (CSS d'`InfoTip`) : rien à calculer.
 * Sans JS, la bulle garde sa position absolue d'avant : le rendu serveur reste lisible.
 */
export function brancherPlacement(groupe: HTMLElement, win: Window): () => void {
  const placer = () => {
    const bouton = groupe.querySelector("button");
    const bulle = groupe.querySelector<HTMLElement>('[role="tooltip"]');
    if (!bouton || !bulle || win.innerWidth < 640) {
      groupe.removeAttribute("data-place");
      return;
    }
    groupe.setAttribute("data-place", "");
    const r = bouton.getBoundingClientRect();
    const { x, y } = placerBulle(
      r,
      { largeur: bulle.offsetWidth, hauteur: bulle.offsetHeight },
      { largeur: win.innerWidth, hauteur: win.innerHeight },
      groupe.dataset.side === "top" ? "top" : "bottom",
      groupe.dataset.align === "start" ? "start" : groupe.dataset.align === "end" ? "end" : "center",
    );
    groupe.style.setProperty("--bulle-x", `${Math.round(x)}px`);
    groupe.style.setProperty("--bulle-y", `${Math.round(y)}px`);
  };
  // Un défilement (de la page ou d'un ancêtre) déplace l'icône : la bulle la suit.
  const suivre = () => {
    if (groupe.hasAttribute("data-place")) placer();
  };
  groupe.addEventListener("mouseenter", placer);
  groupe.addEventListener("focusin", placer);
  win.addEventListener("scroll", suivre, { capture: true, passive: true });
  win.addEventListener("resize", suivre);
  return () => {
    groupe.removeEventListener("mouseenter", placer);
    groupe.removeEventListener("focusin", placer);
    win.removeEventListener("scroll", suivre, { capture: true });
    win.removeEventListener("resize", suivre);
  };
}

export function InfoTipEchap() {
  const repere = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const groupe = repere.current?.parentElement;
    if (!groupe) return;
    const sansEchap = brancherEchap(groupe, document);
    const sansPlacement = brancherPlacement(groupe, window);
    return () => {
      sansEchap();
      sansPlacement();
    };
  }, []);

  return <span ref={repere} hidden />;
}
