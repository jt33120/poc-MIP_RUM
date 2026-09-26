"use client";
// Bouton « favori de test » (bookmarklet) à glisser dans la barre de favoris. React
// refuse de rendre un href `javascript:` (sécurité) — on le pose donc impérativement
// via ref, ce qui préserve le glisser-déposer vers les favoris. Un clic dans l'app
// est neutralisé (le favori n'a de sens que lancé sur le site cible). Son libellé
// devient le nom du favori : court, sans émoji (recette du 26/09/2026).
import { useEffect, useRef, useState } from "react";

export function Bookmarklet({ code, label }: { code: string; label: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ref.current?.setAttribute("href", code);
  }, [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papier indisponible : l'utilisateur peut sélectionner le code affiché */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
      <a
        ref={ref}
        draggable
        onClick={(e) => e.preventDefault()}
        title="Glissez-moi dans votre barre de favoris"
        className="btn-accent cursor-grab select-none"
      >
        MIP RUM · mesurer cette page
      </a>
      <span className="text-xs text-ink-soft">← glissez ce bouton dans votre barre de favoris</span>
      <button type="button" onClick={copy} className="btn-ghost">
        {copied ? "Copié ✓" : "Copier le code"}
      </button>
      <span className="sr-only">{label}</span>
    </div>
  );
}
