"use client";
// Échap ferme la bulle d'`InfoTip` (F69, WCAG 1.4.13 « contenu au survol ou au
// focus ») : un contenu qui s'ouvre au focus ou au survol doit pouvoir être masqué
// SANS déplacer le focus ni le pointeur. La bulle s'ouvre en CSS pur ; cet îlot pose
// seulement `data-ferme` sur son groupe à l'appui d'Échap, et le retire quand le
// focus ou le pointeur QUITTE le groupe : la bulle se rouvre au passage suivant.
import { useEffect, useRef } from "react";

export function InfoTipEchap() {
  const repere = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const groupe = repere.current?.parentElement;
    if (!groupe) return;
    const fermer = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (groupe.contains(document.activeElement) || groupe.matches(":hover")) groupe.setAttribute("data-ferme", "");
    };
    const rearmer = (e: Event) => {
      // Un focus qui passe d'un élément du groupe à un autre ne le quitte pas.
      if (e instanceof FocusEvent && e.relatedTarget instanceof Node && groupe.contains(e.relatedTarget)) return;
      groupe.removeAttribute("data-ferme");
    };
    document.addEventListener("keydown", fermer);
    groupe.addEventListener("focusout", rearmer);
    groupe.addEventListener("mouseleave", rearmer);
    return () => {
      document.removeEventListener("keydown", fermer);
      groupe.removeEventListener("focusout", rearmer);
      groupe.removeEventListener("mouseleave", rearmer);
    };
  }, []);

  return <span ref={repere} hidden />;
}
