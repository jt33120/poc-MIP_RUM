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

export function InfoTipEchap() {
  const repere = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const groupe = repere.current?.parentElement;
    if (!groupe) return;
    return brancherEchap(groupe, document);
  }, []);

  return <span ref={repere} hidden />;
}
