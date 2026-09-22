"use client";
// Îlot clavier du panneau latéral (F07, § 3.5) : focus sur le titre à l'ouverture,
// Échap = « Fermer », ↑ / ↓ = précédent / suivant. Les liens du panneau restent la
// vérité (sans JS, ils suffisent) ; ici, on ne fait que les suivre au clavier.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Là où une flèche ou Échap a déjà un sens (saisie, groupe de choix), on n'y touche pas.
const DEJA_PRIS = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider'], [role='tablist']";

export function DetailPanelKeys(p: { titreId: string; cle: string; fermerHref: string; precedentHref?: string | null; suivantHref?: string | null }) {
  const router = useRouter();
  const { titreId, cle, fermerHref, precedentHref, suivantHref } = p;
  useEffect(() => {
    // À la fermeture, le focus revient à ce qui a ouvert le panneau (la ligne cliquée).
    const avant = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    document.getElementById(titreId)?.focus({ preventScroll: true });
    return () => {
      if (avant?.isConnected) avant.focus({ preventScroll: true });
    };
  }, [titreId, cle]);
  useEffect(() => {
    function touche(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if (e.target instanceof Element && e.target.closest(DEJA_PRIS)) return;
      const href = e.key === "Escape" ? fermerHref : e.key === "ArrowUp" ? precedentHref : e.key === "ArrowDown" ? suivantHref : null;
      if (!href) return;
      e.preventDefault();
      router.push(href, { scroll: false });
    }
    document.addEventListener("keydown", touche);
    return () => document.removeEventListener("keydown", touche);
  }, [router, fermerHref, precedentHref, suivantHref]);
  return null;
}
